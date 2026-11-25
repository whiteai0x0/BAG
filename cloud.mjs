import {beginVerification,verify,manage,role,validEmail} from './accounts.mjs';
import {downloadExtension} from './extension-download.mjs';
import http from 'node:http';
import {httpServerHandler} from 'cloudflare:node';
import {env} from 'cloudflare:workers';
import {neon} from '@neondatabase/serverless';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {kinds} from './web/kinds.mjs';
import {detectCloudKind as classifyCloud} from './cloud-ai.mjs';
const detectKind=item=>classifyCloud(item,env.AI);
const digest=value=>createHash('sha256').update(value).digest('hex');
const secure=true;
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
function prepare(sql,statement){
 let n=0;
 const text=statement.replace(/\?/g,()=>'$'+(++n));
 const rows=(...args)=>sql.query(text,args);
 return {all:rows,get:async(...args)=>(await rows(...args))[0],run:async(...args)=>({changes:(await sql.query(text,args,{fullResults:true})).rowCount})};
}
async function rateLimit(sql,key,max){
 const now=Date.now();
 const rows=await sql.query(`INSERT INTO request_limits VALUES ($1,1,$2)
 ON CONFLICT(key) DO UPDATE SET count=CASE WHEN request_limits.until_ms <= $3 THEN 1 ELSE request_limits.count+1 END,
 until_ms=CASE WHEN request_limits.until_ms <= $3 THEN EXCLUDED.until_ms ELSE request_limits.until_ms END RETURNING count`,[key,now+60000,now]);
 if(rows[0].count>max)fail(429,'Too many requests. Try again in a minute.');
}
async function body(req){
 if(req.headers['content-type']?.split(';')[0]!=='application/json') fail(415,'Send JSON.');
 let parts=[],size=0;
 for await(const chunk of req){if((size+=chunk.length)> (req.url==='/api/items'?180000:16384)) fail(413,'Request too large.');parts.push(chunk)}
 try{const data=JSON.parse(Buffer.concat(parts));if(data && typeof data==='object'&&!Array.isArray(data))return data}catch{}
 fail(400,'Invalid JSON object.');
}
function safeUrl(value){
 let u;try{u=new URL(value)}catch{}
 if(!u || !['http:','https:'].includes(u.protocol)||u.username||u.password||u.href.length>8192)fail(400,'Enter an HTTP or HTTPS URL without embedded credentials.');
 const sensitive=/^(access_token|refresh_token|id_token|token|password|session(id)?|auth|code|signature|x-amz-signature|api[_-]?key)$/i;
 for(const params of [u.searchParams,new URLSearchParams(u.hash.slice(1).split('?').pop())]){
  if([...params.keys()].some(k=>sensitive.test(k)))fail(400,'Remove authentication parameters before saving.');
 }
 return u;
}
const fields='id,url,title,domain,capture_type,captured_at,created_at,kind,selected_text,source_url,picture_url,(picture IS NOT NULL) AS has_picture';
const cookie=(token,age)=>'bag='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+age+(secure?'; Secure':'');
const server=http.createServer(async(req,res)=>{
 const json=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data))};
 try{
 const sql=neon(env.DATABASE_URL);
 const query=statement=>prepare(sql,statement);
 const limit=(key,max)=>rateLimit(sql,key,max);
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' https: http:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 const url=new URL(req.url,'http://localhost'),path=url.pathname,m=req.method;
 const origin=req.headers.origin;
 if(m!=='GET' && origin && !origin.startsWith('chrome-extension://') && origin!==(secure?'https://':'http://')+req.headers.host) fail(403,'Origin mismatch.');
 if(m==='POST'&&['/api/register','/api/login','/api/verify'].includes(path)){
 await limit('auth:'+req.headers['cf-connecting-ip'],30);const b=await body(req),email=String(b.email||'').trim().toLowerCase(),password=b.password;
 let user;
 if(path==='/api/verify'){user=await verify(sql,env,b)}else{
 if(!validEmail(email)||email.length>254||typeof password!=='string'||password.length>256)fail(400,'Enter a valid email and password.');
 user=await query('SELECT * FROM users WHERE email=?').get(email);
 if(path.endsWith('register')){
 if(password.length<12)fail(400,'Use at least 12 characters for your password.');
 if(user)fail(409,'Account already exists. Sign in to continue.');
 return json(202,await beginVerification(sql,env,email,digest(password)));
 }else{
 const match=await sql.query("SELECT crypt($1,COALESCE($2,gen_salt('bf',10)))=$2 AS ok",[digest(password),user?.hash??null]);
 if(!match[0].ok)fail(401,'Email or password is incorrect.');
 }
 if(user.suspended)fail(403,'This account is suspended.');
 if(!user.verified){
   if(b.client==='extension')fail(403,'Verify your email by signing in on the BAG website first.');
   return json(202,await beginVerification(sql,env,email,digest(password)));
 }
 }
 await sql.query('DELETE FROM sessions WHERE expires < $1',[Date.now()]);
 const token=randomBytes(32).toString('hex');await query('INSERT INTO sessions(token,owner,expires,version) VALUES(?,?,?,?)').run(digest(token),user.id,Date.now()+30*86400000,user.session_version);
 if(b.client==='extension')return json(200,{token,email:user.email});
 res.setHeader('Set-Cookie',cookie(token,2592000));return json(200,{email:user.email});
 }
 const token=req.headers.authorization?.replace(/^Bearer /,'')||req.headers.cookie?.match(/(?:^|; )bag=([a-f0-9]+)/)?.[1]||'';
 const user=await query('SELECT users.* FROM sessions JOIN users ON users.id=sessions.owner WHERE token=? AND expires>? AND users.verified AND NOT users.suspended AND sessions.version=users.session_version').get(digest(token),Date.now());
 if(!user)fail(401,'Sign in to your BAG.');
 if(path==='/api/admin/users')return json(200,await manage(sql,user,m,m==='GET'?Object.fromEntries(url.searchParams):await body(req)));
 if(path==='/api/me'&&m==='GET')return json(200,{email:user.email,role:role(user),ai_enabled:Boolean(env.AI)});
 if(path==='/api/logout'&&m==='POST'){await body(req);await query('DELETE FROM sessions WHERE token=?').run(digest(token));res.setHeader('Set-Cookie',cookie('',0));return json(200,{})}
 if(path==='/api/items'&&m==='GET'){
 const q=(url.searchParams.get('q')||'').slice(0,512),offset=Number(url.searchParams.get('offset')||0);
 if(!Number.isSafeInteger(offset)||offset<0)fail(400,'Invalid offset.');
 const where=' FROM items WHERE owner=? AND (strpos(lower(title),lower(?))>0 OR strpos(lower(domain),lower(?))>0 OR strpos(lower(selected_text),lower(?))>0)';
 return json(200,{items:await query('SELECT '+fields+where+' ORDER BY created_at DESC,id LIMIT 48 OFFSET ?').all(user.id,q,q,q,offset),total:(await query('SELECT count(*)::int n'+where).get(user.id,q,q,q)).n});
 }
 if(path==='/api/items'&&m==='POST'){
 await limit('save:'+user.id,120);const b=await body(req),u=safeUrl(b.url),type=b.capture_type??'manual',date=new Date(b.captured_at??Date.now());
 if(!['manual','page','link','image','selection'].includes(type)||!Number.isFinite(date.getTime()))fail(400,'Invalid capture details.');
 const passage=type==='selection'?b.selected_text:null;
 if(type==='selection' && (typeof passage!=='string'||!passage.trim()||passage.length>24000))fail(400,'Select between 1 and 24,000 characters.');
 const source=type==='image'?safeUrl(b.source_url).href:type==='selection'?u.href:null;
 const key=type==='selection'?'text:'+digest(JSON.stringify([source,passage])):type==='image'?'image:'+digest(JSON.stringify([source,u.href])):'url:'+digest(u.href);
 const title=String(b.captured_title||'').trim().slice(0,512)||u.hostname;
 const explicit=type==='manual'&&b.kind;
 const hint=type==='page'?(b.detected_kind||b.kind):null;
 const detection=explicit?{kind:b.kind,method:'manual'}:await detectKind({url:u.href,title,capture_type:type,hint});
 const {kind}=detection;
 if(!kinds.includes(kind))fail(400,'Choose a supported item type.');
 let picture=null;
 if(b.picture){
   if(typeof b.picture!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(b.picture))fail(400,'Choose a JPEG reference picture.');
   picture=Buffer.from(b.picture.split(',')[1],'base64');
   if(picture.length>125000||picture.length<4||picture.readUInt16BE(0)!==0xffd8||picture.readUInt16BE(picture.length-2)!==0xffd9)fail(400,'Invalid reference picture.');
 }
 let remote=null;
 if(b.picture_url){try{remote=safeUrl(b.picture_url).href}catch{ /* Save the capture even if its optional preview URL is unsuitable. */ }}
 const result=await query('INSERT INTO items(id,owner,url,title,domain,capture_type,captured_at,created_at,kind,picture,selected_text,source_url,capture_key,picture_url,kind_mode) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING').run(randomUUID(),user.id,u.href,title,u.hostname,type,date.toISOString(),new Date().toISOString(),kind,picture?.toString('base64')??null,passage,source,key,remote,type==='manual'&&b.kind?'manual':'auto');
 if(!result.changes && kind!=='Website')await query("UPDATE items SET kind=? WHERE owner=? AND capture_key=? AND kind_mode='auto' AND kind='Website'").run(kind,user.id,key);
 if(!result.changes && remote)await query('UPDATE items SET picture_url=? WHERE owner=? AND capture_key=? AND picture_url IS NULL').run(remote,user.id,key);
 if(!result.changes && picture)await query('UPDATE items SET picture=? WHERE owner=? AND capture_key=? AND picture IS NULL').run(picture.toString('base64'),user.id,key);
 return json(result.changes?201:200,{...await query('SELECT '+fields+' FROM items WHERE owner=? AND capture_key=?').get(user.id,key),detection_method:result.changes?detection.method:'existing',status:result.changes?'saved':'duplicate'});
 }
 const preview=path.match(/^\/api\/items\/([a-f0-9-]+)\/picture$/);
 if(preview && m==='GET'){
   const row=await query('SELECT picture FROM items WHERE owner=? AND id=?').get(user.id,preview[1]);
   if(!row?.picture)fail(404,'Picture unavailable.');
   res.setHeader('Content-Type','image/jpeg');res.end(Buffer.from(row.picture,'base64'));return;
 }
 const id=path.match(/^\/api\/items\/([a-f0-9-]+)$/)?.[1];
 if(id){const item=await query('SELECT '+fields+' FROM items WHERE id=? AND owner=?').get(id,user.id);
 if(!item)fail(404,'Item unavailable.');
 if(m==='GET')return json(200,item);
 if(m==='PATCH'){const edits=await body(req);if('kind' in edits){const auto=edits.kind==='auto';
 if(auto)await limit('detect:'+user.id,30);
 const detection=auto?await detectKind(item):{kind:edits.kind,method:'manual'};
 const {kind}=detection;
 if(!kinds.includes(kind))fail(400,'Unknown type.');await query('UPDATE items SET kind=?,kind_mode=? WHERE id=? AND owner=?').run(kind,auto?'auto':'manual',id,user.id);return json(200,{...item,kind,detection_method:detection.method})}const {title}=edits;if(typeof title!=='string'||!title.trim()||title.length>512)fail(400,'Use a title of 1–512 characters.');
 await query('UPDATE items SET title=? WHERE id=? AND owner=?').run(title.trim(),id,user.id);return json(200,{...item,title:title.trim()})}
 if(m==='DELETE'){await body(req);await query('DELETE FROM items WHERE id=? AND owner=?').run(id,user.id);return json(200,{})}
 }
 fail(404,'Page unavailable.');
 }catch(e){json(e.status||500,{error:e.status?e.message:'Server error.'})}
});
const api=httpServerHandler(server);
export default {
 fetch(request,bindings,ctx){
   const url=new URL(request.url);
   if(url.pathname==='/download-extension' && request.method==='GET')return downloadExtension(url.origin);
   return api.fetch(request,bindings,ctx);
 }
};
