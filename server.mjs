import {detectKind} from './detect.mjs';
import {classify,kinds} from './web/kinds.mjs';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,scrypt,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
const hashPassword=promisify(scrypt);
const db=new DatabaseSync(process.env.BAG_DB || 'bag.sqlite');
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE,salt TEXT,hash TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,owner TEXT,expires INTEGER);
CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,owner TEXT,url TEXT,title TEXT,domain TEXT,capture_type TEXT,captured_at TEXT,created_at TEXT,UNIQUE(owner,url));
CREATE INDEX IF NOT EXISTS collection ON items(owner,created_at DESC);`);
const query=(sql)=>db.prepare(sql);
const columns=query('PRAGMA table_info(items)').all().map(row=>row.name);
db.exec('BEGIN');
try {
 if(!columns.includes('kind')){
   db.exec("ALTER TABLE items ADD COLUMN kind TEXT NOT NULL DEFAULT 'Website'");
   for(const item of query('SELECT id,url FROM items').all())
     query('UPDATE items SET kind=? WHERE id=?').run(classify(item.url),item.id);
 }
 if(!columns.includes('picture'))db.exec('ALTER TABLE items ADD COLUMN picture BLOB');
 if(!columns.includes('capture_key')){
   db.exec(`CREATE TABLE upgraded_items(id TEXT PRIMARY KEY,owner TEXT,url TEXT,title TEXT,domain TEXT,capture_type TEXT,captured_at TEXT,created_at TEXT,kind TEXT,picture BLOB,selected_text TEXT,source_url TEXT,capture_key TEXT NOT NULL,UNIQUE(owner,capture_key));
     INSERT INTO upgraded_items SELECT id,owner,url,title,domain,capture_type,captured_at,created_at,kind,picture,NULL,NULL,'url:'||url FROM items;
     DROP TABLE items;
     ALTER TABLE upgraded_items RENAME TO items;
     CREATE INDEX collection ON items(owner,created_at DESC);`);
 }
 if(!columns.includes('picture_url'))db.exec('ALTER TABLE items ADD COLUMN picture_url TEXT');
 if(!columns.includes('kind_mode'))db.exec("ALTER TABLE items ADD COLUMN kind_mode TEXT NOT NULL DEFAULT 'legacy'");
 db.exec('COMMIT');
}catch(error){db.exec('ROLLBACK');throw error}
const digest=t=>createHash('sha256').update(t).digest('hex');
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const limits=new Map();
setInterval(()=>{for(const [key,v] of limits) if(v.until<Date.now()) limits.delete(key);query('DELETE FROM sessions WHERE expires<?').run(Date.now())},60000).unref();
function limit(key,max){
 let v=limits.get(key);
 if(!v || v.until<Date.now()) limits.set(key,v={count:0,until:Date.now()+60000});
 if(++v.count>max) fail(429,'Too many requests. Try again in a minute.');
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
const assets={'/install.html':['install.html','text/html'],'/logo.png':['logo.png','image/png'],'/download-extension':['bag-extension.zip','application/zip'],'/kinds.mjs':['kinds.mjs','text/javascript'],'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']};
const secure=process.env.BAG_HTTPS==='1';
const cookie=(token,age)=>'bag='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+age+(secure?'; Secure':'');
const server=http.createServer(async(req,res)=>{
 const json=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data))};
 try{
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' https: http:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 const url=new URL(req.url,'http://localhost'),path=url.pathname,m=req.method;
 if(m==='GET'&&Object.hasOwn(assets,path)){const [name,type]=assets[path];res.setHeader('Content-Type',type);const content=await readFile(new URL('./web/'+name,import.meta.url));
 if(path==='/'){const options=kinds.map(kind=>'<option value="'+kind+'">'+kind+'</option>').join('');res.end(content.toString().replace('<!--BAG_KINDS-->',options))}else res.end(content);return}
 const origin=req.headers.origin;
 if(m!=='GET' && origin && !origin.startsWith('chrome-extension://') && origin!==(secure?'https://':'http://')+req.headers.host) fail(403,'Origin mismatch.');
 if(m==='POST'&&['/api/register','/api/login'].includes(path)){
 limit('auth:'+req.socket.remoteAddress,30);const b=await body(req),email=String(b.email||'').trim().toLowerCase(),password=b.password;
 if(!/^\S+@\S+\.\S+$/.test(email)||email.length>254||typeof password!=='string'||password.length>256)fail(400,'Enter a valid email and password.');
 let user=query('SELECT * FROM users WHERE email=?').get(email);
 if(path.endsWith('register')){
 if(password.length<12)fail(400,'Use at least 12 characters for your password.');
 const salt=randomBytes(16).toString('hex'),hash=(await hashPassword(password,salt,64)).toString('hex'),id=randomUUID();
 if(!query('INSERT OR IGNORE INTO users VALUES(?,?,?,?)').run(id,email,salt,hash).changes)fail(409,'Email already registered.');
 user={id};
 }else{
 const hash=await hashPassword(password,user?.salt||'missing-account',64);
 if(!user||!timingSafeEqual(hash,Buffer.from(user.hash,'hex')))fail(401,'Email or password is incorrect.');
 }
 const token=randomBytes(32).toString('hex');query('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),user.id,Date.now()+30*86400000);
 if(b.client==='extension')return json(200,{token,email});
 res.setHeader('Set-Cookie',cookie(token,2592000));return json(200,{email});
 }
 const token=req.headers.authorization?.replace(/^Bearer /,'')||req.headers.cookie?.match(/(?:^|; )bag=([a-f0-9]+)/)?.[1]||'';
 const user=query('SELECT users.* FROM sessions JOIN users ON users.id=sessions.owner WHERE token=? AND expires>?').get(digest(token),Date.now());
 if(!user)fail(401,'Sign in to your BAG.');
 if(path==='/api/me'&&m==='GET')return json(200,{email:user.email,ai_enabled:process.env.BAG_AI_PROVIDER==='ollama'||Boolean(process.env.OPENAI_API_KEY)});
 if(path==='/api/logout'&&m==='POST'){await body(req);query('DELETE FROM sessions WHERE token=?').run(digest(token));res.setHeader('Set-Cookie',cookie('',0));return json(200,{})}
 if(path==='/api/items'&&m==='GET'){
 const q=(url.searchParams.get('q')||'').slice(0,512),offset=Number(url.searchParams.get('offset')||0);
 if(!Number.isSafeInteger(offset)||offset<0)fail(400,'Invalid offset.');
 const where=' FROM items WHERE owner=? AND (instr(lower(title),lower(?)) OR instr(lower(domain),lower(?)) OR instr(lower(selected_text),lower(?)))';
 return json(200,{items:query('SELECT '+fields+where+' ORDER BY created_at DESC,id LIMIT 48 OFFSET ?').all(user.id,q,q,q,offset),total:query('SELECT count(*) n'+where).get(user.id,q,q,q).n});
 }
 if(path==='/api/items'&&m==='POST'){
 limit('save:'+user.id,120);const b=await body(req),u=safeUrl(b.url),type=b.capture_type??'manual',date=new Date(b.captured_at??Date.now());
 if(!['manual','page','link','image','selection'].includes(type)||!Number.isFinite(date.getTime()))fail(400,'Invalid capture details.');
 const passage=type==='selection'?b.selected_text:null;
 if(type==='selection' && (typeof passage!=='string'||!passage.trim()||passage.length>24000))fail(400,'Select between 1 and 24,000 characters.');
 const source=type==='image'?safeUrl(b.source_url).href:type==='selection'?u.href:null;
 const key=type==='selection'?'text:'+digest(JSON.stringify([source,passage])):type==='image'?'image:'+digest(JSON.stringify([source,u.href])):'url:'+u.href;
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
 const result=query('INSERT OR IGNORE INTO items(id,owner,url,title,domain,capture_type,captured_at,created_at,kind,picture,selected_text,source_url,capture_key,picture_url,kind_mode) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),user.id,u.href,title,u.hostname,type,date.toISOString(),new Date().toISOString(),kind,picture,passage,source,key,remote,type==='manual'&&b.kind?'manual':'auto');
 if(!result.changes && kind!=='Website')query("UPDATE items SET kind=? WHERE owner=? AND capture_key=? AND kind_mode='auto' AND kind='Website'").run(kind,user.id,key);
 if(!result.changes && remote)query('UPDATE items SET picture_url=? WHERE owner=? AND capture_key=? AND picture_url IS NULL').run(remote,user.id,key);
 if(!result.changes && picture)query('UPDATE items SET picture=? WHERE owner=? AND capture_key=? AND picture IS NULL').run(picture,user.id,key);
 return json(result.changes?201:200,{...query('SELECT '+fields+' FROM items WHERE owner=? AND capture_key=?').get(user.id,key),detection_method:result.changes?detection.method:'existing',status:result.changes?'saved':'duplicate'});
 }
 const preview=path.match(/^\/api\/items\/([a-f0-9-]+)\/picture$/);
 if(preview && m==='GET'){
   const row=query('SELECT picture FROM items WHERE owner=? AND id=?').get(user.id,preview[1]);
   if(!row?.picture)fail(404,'Picture unavailable.');
   res.setHeader('Content-Type','image/jpeg');res.end(Buffer.from(row.picture));return;
 }
 const id=path.match(/^\/api\/items\/([a-f0-9-]+)$/)?.[1];
 if(id){const item=query('SELECT '+fields+' FROM items WHERE id=? AND owner=?').get(id,user.id);
 if(!item)fail(404,'Item unavailable.');
 if(m==='GET')return json(200,item);
 if(m==='PATCH'){const edits=await body(req);if('kind' in edits){const auto=edits.kind==='auto';
 if(auto)limit('detect:'+user.id,30);
 const detection=auto?await detectKind(item):{kind:edits.kind,method:'manual'};
 const {kind}=detection;
 if(!kinds.includes(kind))fail(400,'Unknown type.');query('UPDATE items SET kind=?,kind_mode=? WHERE id=? AND owner=?').run(kind,auto?'auto':'manual',id,user.id);return json(200,{...item,kind,detection_method:detection.method})}const {title}=edits;if(typeof title!=='string'||!title.trim()||title.length>512)fail(400,'Use a title of 1–512 characters.');
 query('UPDATE items SET title=? WHERE id=? AND owner=?').run(title.trim(),id,user.id);return json(200,{...item,title:title.trim()})}
 if(m==='DELETE'){await body(req);query('DELETE FROM items WHERE id=? AND owner=?').run(id,user.id);return json(200,{})}
 }
 fail(404,'Page unavailable.');
 }catch(e){json(e.status||500,{error:e.status?e.message:'Server error.'})}
});
server.listen(Number(process.env.PORT||8787),process.env.HOST||'127.0.0.1');
