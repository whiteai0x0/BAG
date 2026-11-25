import test from 'node:test';
import assert from 'node:assert/strict';
import {detectCloudKind} from './cloud-ai.mjs';
test('hosted classification excludes URL credentials and validates its label',async()=>{
 const item={url:'https://example.com/watch?q=hidden#private',title:'Clip'};
 const ai={run:async(model,input)=>{
   assert.ok(!JSON.stringify(input).includes('hidden'));
   assert.ok(!JSON.stringify(input).includes('#private'));
   return {choices:[{message:{content:'Video'}}]};
 }};
 assert.deepEqual(await detectCloudKind(item,ai),{kind:'Video',method:'ai'});
 for(const run of [async()=>({response:'Unknown'}),async()=>{throw Error('Quota')}])
   assert.equal((await detectCloudKind(item,{run})).method,'fallback');
 assert.deepEqual(await detectCloudKind({...item,capture_type:'selection'},ai),{kind:'Text',method:'capture'});
});
