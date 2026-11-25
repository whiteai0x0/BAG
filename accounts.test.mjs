import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {beginVerification,manage,role,validEmail} from './accounts.mjs';
test('owner requires verified active mailbox and ordinary users cannot list users',async()=>{
 const owner={email:'romanlotsman22@gmail.com',verified:true};
 assert.equal(role(owner),'owner');
 assert.equal(role({...owner,verified:false}),'user');
 assert.equal(role({...owner,suspended:true}),'user');
 await assert.rejects(manage(null,{email:'reader@example.com',verified:true},'GET',{}),{status:403});
 await assert.rejects(manage(null,{email:'admin@example.com',verified:true,is_admin:true},'POST',{action:'promote'}),{status:403});
 assert.equal(validEmail('a@example.com,b@example.com'),false);
});
test('mailer receives the code while storage receives a challenge-specific HMAC',async t=>{
 const env={MAIL_SECRET:'test-only',MAIL_SCRIPT_URL:'https://example.invalid/mail'};
 let params,message;
 const sql={query:async(_,args)=>{params=args;return [{}]}};
 t.mock.method(globalThis,'fetch',async(_,request)=>{message=JSON.parse(request.body);return Response.json({sent:true})});
 const {challenge}=await beginVerification(sql,env,'reader@example.com','password-digest');
 assert.match(message.code,/^\d{6}$/);
 assert.equal(params[3],createHmac('sha256',env.MAIL_SECRET).update(challenge+':'+message.code).digest('hex'));
 assert.equal(message.email,'reader@example.com');
});
test('failed delivery invalidates the pending request',async t=>{
 const statements=[];
 t.mock.method(globalThis,'fetch',async()=>Response.json({sent:false}));
 await assert.rejects(beginVerification({query:async s=>{statements.push(s);return [{}]}},{MAIL_SECRET:'test',MAIL_SCRIPT_URL:'https://example.invalid'},'user@example.com','digest'),{status:503});
 assert.match(statements.at(-1),/^DELETE FROM verification WHERE challenge=/);
});
