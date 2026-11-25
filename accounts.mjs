import {randomInt,randomUUID,createHmac} from 'node:crypto';
const owner='romanlotsman22@gmail.com';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
export function role(user){
 if(!user.verified||user.suspended)return 'user';
 return user.email===owner?'owner':user.is_admin?'admin':'user';
}
export function validEmail(email){
 return typeof email==='string'&&email.length<=254&&/^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(email);
}
function proof(secret,id,code){return createHmac('sha256',secret).update(id+':'+code).digest('hex')}
export async function beginVerification(sql,env,email,passwordDigest){
 if(!env.MAIL_SECRET||!env.MAIL_SCRIPT_URL)fail(503,'Email verification is not configured.');
 const challenge=randomUUID(),code=String(randomInt(1000000)).padStart(6,'0');
 const rows=await sql.query(`INSERT INTO verification(email,challenge,password_hash,proof,expires)
 VALUES($1,$2,crypt($3,gen_salt('bf',10)),$4,now()+interval '10 minutes')
 ON CONFLICT(email) DO UPDATE SET challenge=excluded.challenge,password_hash=excluded.password_hash,
 proof=excluded.proof,expires=excluded.expires,attempts=0
 WHERE verification.expires<=now()+interval '9 minutes' RETURNING challenge`,
 [email,challenge,passwordDigest,proof(env.MAIL_SECRET,challenge,code)]);
 if(!rows.length)fail(429,'Wait one minute before requesting another code.');
 try{
   const response=await fetch(env.MAIL_SCRIPT_URL,{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({secret:env.MAIL_SECRET,email,code}),signal:AbortSignal.timeout(18000)});
   if(!response.ok||!(await response.json()).sent)throw Error();
 }catch{
   await sql.query('DELETE FROM verification WHERE challenge=$1',[challenge]);
   fail(503,'Email delivery failed. Please try again later.');
 }
 return {challenge};
}
export async function verify(sql,env,{challenge,code}){
 if(typeof challenge!=='string'||!/^([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/.test(challenge)||!/^\d{6}$/.test(code)||typeof code!=='string')fail(400,'Enter the six-digit code.');
 const rows=await sql.query(`WITH attempt AS (
 UPDATE verification SET attempts=CASE WHEN proof=$2 THEN 5 ELSE attempts+1 END
 WHERE challenge=$1 AND expires>now() AND attempts<5 RETURNING email,password_hash,proof)
 INSERT INTO users(id,email,hash,verified)
 SELECT $3,email,password_hash,true FROM attempt WHERE proof=$2
 ON CONFLICT(email) DO UPDATE SET verified=true,hash=excluded.hash
 WHERE NOT users.verified AND NOT users.suspended RETURNING id,email,session_version`,
 [challenge,proof(env.MAIL_SECRET,challenge,code),randomUUID()]);
 if(!rows.length)fail(400,'Incorrect, expired, or already used code. Request another if needed.');
 return rows[0];
}
export async function manage(sql,actor,method,input){
 const level=role(actor);
 if(level==='user')fail(403,'Administrator access required.');
 if(method==='GET'){
   const offset=Number(input.offset||0);
   if(!Number.isSafeInteger(offset)||offset<0)fail(400,'Invalid offset.');
   const rows=await sql.query('SELECT id,email,verified,is_admin,suspended FROM users ORDER BY email LIMIT 51 OFFSET $1',[offset]);
   return {more:rows.length>50,users:rows.slice(0,50).map(u=>({id:u.id,email:u.email,role:u.email===owner?'owner':u.is_admin?'admin':'user',verified:u.verified,suspended:u.suspended}))};
 }
 const {id,action}=input;
 if(method!=='POST'||!['promote','demote','suspend','restore'].includes(action))fail(400,'Unknown account action.');
 const changeRole=['promote','demote'].includes(action);
 if(changeRole&&level!=='owner')fail(403,'Only the owner can change administrator roles.');
 const assignment=changeRole?'is_admin=$4':'suspended=$4';
 const rows=await sql.query(`UPDATE users AS target SET ${assignment},session_version=target.session_version+1
 FROM users AS actor WHERE actor.id=$1 AND actor.verified AND NOT actor.suspended
 AND (actor.email=$3 OR (actor.is_admin AND NOT target.is_admin AND NOT $5::boolean))
 AND target.id=$2 AND target.id<>actor.id AND target.email<>$3
 AND (NOT $6::boolean OR (target.verified AND NOT target.suspended)) RETURNING target.id`,
 [actor.id,id,owner,['promote','suspend'].includes(action),changeRole,action==='promote']);
 if(!rows.length)fail(403,'This account action is unavailable.');
 return {ok:true};
}
