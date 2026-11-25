import assert from 'node:assert/strict';
import vm from 'node:vm';

export async function checkStartup(base,token){
 const page=await (await fetch(base)).text();
 const scriptPath=page.match(/<script type="module" src="([^"]+)"/)[1];
 const script=await fetch(base+scriptPath);
 assert.match(script.headers.get('content-type'),/javascript/);
 const nodes=new Map([...page.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)].map(([tag,id])=>[id,{hidden:/\bhidden\b/.test(tag),replaceChildren(){},append(){}}]));
 assert.match(page,/<option value="Software">/);
 const context={
   document:{getElementById:id=>nodes.get(id),querySelectorAll:()=>[]},
   window:{addEventListener(){}},AbortSignal,URL,
   fetch:(path,options)=>fetch(base+path,{...options,headers:{...options.headers,...(token?{Authorization:'Bearer '+token}:{})}})
 };
 await vm.runInNewContext(await script.text(),context,{
   filename:new URL('./web/app.js',import.meta.url).pathname,
   importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER
 });
 nodes.get('url').value='https://www.youtube.com/watch?v=example';
 nodes.get('kind').options=[{}];
 await nodes.get('url').oninput();
 assert.equal(nodes.get('kind').options[0].textContent,'Auto-detect · Video');
 assert.equal(nodes.get('startup').hidden,true);
 assert.equal(nodes.get('auth').hidden,Boolean(token));
 assert.equal(nodes.get('collection').hidden,!token);
}
