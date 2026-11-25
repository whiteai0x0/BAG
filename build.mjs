import {cp,readFile,writeFile} from 'node:fs/promises';
import {kinds} from './web/kinds.mjs';
await cp('web','public',{recursive:true});
const template=await readFile('web/index.html','utf8');
await writeFile('public/index.html',template.replace('<!--BAG_KINDS-->',kinds.map(k=>`<option value="${k}">${k}</option>`).join('')));
await writeFile('public/_headers',`/*
  Content-Security-Policy: default-src 'self'; img-src 'self' https: http:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
`);
// Bundle the current extension files for per-deployment downloads.
const {readdir}=await import('node:fs/promises');
const files={};
for(const name of await readdir('extension')){
 files[name]=(await readFile('extension/'+name)).toString('base64');
}
await writeFile('extension-bundle.json',JSON.stringify(files));
