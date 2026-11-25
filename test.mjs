import {checkStartup} from './dashboard-test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {capture} from './extension/client.js';
test('capture chooses the clicked target and keeps the page title only for page captures',()=>{
 const tab={url:'https://example.org/page',title:'Page title'};
 assert.equal(capture({linkUrl:'https://example.org/destination'},tab).url,'https://example.org/destination');
 assert.equal(capture({linkUrl:tab.url},tab).captured_title,'');
 assert.equal(capture({},tab).captured_title,'Page title');
 assert.throws(()=>capture({pageUrl:'chrome://settings'},tab));
});
test('account isolation, capture, duplicate, search, edit, delete and logout',async t=>{
 const dir=await mkdtemp(join(process.cwd(),'.bag-test-')),port=21539;
 const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,OPENAI_API_KEY:'',PORT:String(port),BAG_DB:join(dir,'db')}});
 t.after(async()=>{server.kill();await new Promise(r=>server.once('exit',r));await rm(dir,{recursive:true})});
 const base='http://127.0.0.1:'+port;
 for(let i=0;i<50;i++){try{await fetch(base);break}catch{await new Promise(r=>setTimeout(r,50))}}
 const api=(path,method='GET',data,token)=>fetch(base+'/api/'+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+(token||'')},body:data&&JSON.stringify(data)});
 const signup=async email=>(await (await api('register','POST',{email,password:'sample password for testing',client:'extension'})).json()).token;
 const a=await signup('a@example.org'),b=await signup('b@example.org');
 await checkStartup(base);await checkStartup(base,a);
 assert.equal((await api('items')).status,401);
 const save=url=>api('items','POST',{url},a);
 const item=await (await save('https://EXAMPLE.org:443/read#one')).json();
 assert.equal(item.url,'https://example.org/read#one');assert.equal(item.title,'example.org');
 assert.equal((await (await save(item.url)).json()).status,'duplicate');
 assert.equal((await save('https://example.org/read#two')).status,201);
 for(const url of ['file:///tmp/x','https://user:pass@example.org','https://example.org/?access_token=x'])assert.equal((await save(url)).status,400);
 assert.equal((await (await api('items','GET',null,b)).json()).total,0);
 const clip=capture({selectionText:'First passage',pageUrl:item.url,linkUrl:'https://other.example'},{});
 assert.equal(clip.url,item.url);
 const put=async data=>(await (await api('items','POST',data,a)).json());
 assert.equal((await put(clip)).selected_text,'First passage');
 assert.equal((await put(clip)).status,'duplicate');
 assert.equal((await put({...clip,selected_text:'Second passage'})).status,'saved');
 assert.equal((await (await api('items?q=passage','GET',null,a)).json()).total,2);
 const image=capture({mediaType:'image',srcUrl:'https://example.org/pic.png',pageUrl:item.url},{});
 const savedImage=await put(image);assert.equal(savedImage.url,image.url);assert.equal(savedImage.source_url,item.url);assert.equal(savedImage.kind,'Image');
 const destination='https://example.org/products/camera';
 const titleClick=await put(capture({pageUrl:item.url,linkUrl:destination},{}));
 const thumbClick=await put(capture({pageUrl:item.url,linkUrl:destination,mediaType:'image',srcUrl:image.url},{}));
 assert.equal(thumbClick.id,titleClick.id);assert.equal(thumbClick.kind,'Product');
 assert.equal(thumbClick.picture_url,image.url);assert.equal(thumbClick.status,'duplicate');
 const withPreview=await put({...image,picture_url:'https://example.org/thumbnail.jpg'});
 assert.equal(withPreview.status,'duplicate');assert.equal(withPreview.picture_url,'https://example.org/thumbnail.jpg');
 const refreshed=await (await api('items/'+withPreview.id,'GET',null,a)).json();
 assert.equal(refreshed.picture_url,withPreview.picture_url);
 const pageCapture={url:'https://example.org/object/abc',capture_type:'page'};
 assert.equal((await put(pageCapture)).kind,'Website');
 assert.equal((await put({...pageCapture,detected_kind:'Product'})).kind,'Product');
 const social=await put({url:'https://www.tiktok.com/@someone/video/123',kind:'Website'});
 assert.equal((await (await api('items/'+social.id,'PATCH',{kind:'auto'},a)).json()).kind,'Video');
 const path='items/'+item.id;
 const picture='data:image/jpeg;base64,'+Buffer.from([255,216,255,217]).toString('base64');
 const enriched=await (await api('items','POST',{url:item.url,picture},a)).json();
 assert.equal(enriched.has_picture,1);assert.equal(enriched.status,'duplicate');
 assert.equal((await api(path+'/picture','GET',null,a)).headers.get('content-type'),'image/jpeg');
 assert.equal((await api(path+'/picture','GET',null,b)).status,404);
 assert.equal((await (await api(path,'PATCH',{kind:'Software'},a)).json()).kind,'Software');
 assert.equal((await api(path,'PATCH',{kind:'unknown'},a)).status,400);
 for(const m of ['GET','DELETE','PATCH'])assert.equal((await api(path,m,m==='GET'?null:{title:'Other'},b)).status,404);
 assert.equal((await api(path,'PATCH',{title:'Reading'},a)).status,200);
 assert.equal((await (await api('items?q=reading','GET',null,a)).json()).total,1);
 assert.equal((await api(path,'DELETE',{},a)).status,200);
 await api('logout','POST',{},a);assert.equal((await api('me','GET',null,a)).status,401);
});

test('menu registration on installation, startup and popup repair', async t => {
 const events={}, menuItems=new Map();
 const event=name=>({addListener:fn=>{events[name]=fn}});
 const runtime={onInstalled:event('install'),onStartup:event('startup'),onMessage:event('message'),getURL:path=>'chrome-extension://test/'+path};
 globalThis.chrome={runtime,contextMenus:{
   onClicked:event('click'),
   update(id,props,callback){
     if(menuItems.has(id))menuItems.set(id,props);
     else runtime.lastError={message:'No such menu'};
     callback();delete runtime.lastError;
   },
   create(menu,callback){menuItems.set(menu.id,menu);delete runtime.lastError;callback()}
 }};
 t.after(()=>delete globalThis.chrome);
 await import('./extension/worker.js');
 for(const event of ['install','startup']){
   events[event]();await new Promise(resolve=>setImmediate(resolve));
   assert.equal(menuItems.size,1);
   assert.ok(menuItems.get('bag').contexts.includes('image'));
 }
 menuItems.clear();
 const reply=await new Promise(resolve=>events.message({type:'check-menu'},{url:runtime.getURL('popup.html')},resolve));
 assert.equal(reply.ready,true);
 assert.equal(menuItems.get('bag').title,'To my BAG');
});

test('recognizes eleven content types from destination URLs',async()=>{
 const {classify,kinds}=await import('./web/kinds.mjs');
 const urls=['example.com','youtu.be/abc','store.steampowered.com/app/12','linkedin.com/in/alex','example.com/products/cup','example.com/blog/story','example.com/theme.mp3','example.com/photo.webp','example.com/report.pdf','google.com/maps/place/Yangon','pypi.org/project/pillow/'];
 assert.deepEqual(urls.map(url=>classify('https://'+url)),kinds.filter(kind=>kind!=='Text'));
});

test('recognizes software listings and installer links',async()=>{
 const {classify}=await import('./web/kinds.mjs');
 for(const url of ['apps.apple.com/us/app/example/id123','play.google.com/store/apps/details?id=test.app','chromewebstore.google.com/detail/app/abc','npmjs.com/package/@example/tool','example.org/download/tool.DMG'])
   assert.equal(classify('https://'+url),'Software');
 for(const url of ['apps.apple.com/us/','notpypi.org/project/tool','example.org/tool.exe.txt'])
   assert.equal(classify('https://'+url),'Website');
});

test('a page can supply its reference picture through metadata alone',async t=>{
 const {readPicture}=await import('./extension/picture.js');
 const href='https://example.org/articles/story';
 globalThis.location={href};
 globalThis.document={baseURI:href,images:[],querySelector:()=>({content:'/media/cover.jpg'})};
 t.after(()=>{delete globalThis.document;delete globalThis.location});
 assert.deepEqual(readPicture(href,false,''),{picture_url:'https://example.org/media/cover.jpg'});
});

test('AI selects an allowed type from limited metadata and falls back on provider failures',async()=>{
 const {detectKind}=await import('./detect.mjs');
 const item={url:'https://example.org/item/42?q=private#secret',title:'A ceramic cup',selected_text:'private passage'};
 const send=async (endpoint,options)=>{
   assert.equal(endpoint,'https://api.openai.com/v1/chat/completions');
   const payload=JSON.parse(options.body);
   assert.deepEqual(JSON.parse(payload.messages[1].content),{host:'example.org',path:'/item/42',title:'A ceramic cup',suggestion:'Website'});
   return Response.json({choices:[{message:{content:'{"kind":"Product"}'}}]});
 };
 assert.deepEqual(await detectKind(item,{key:'test',send}),{kind:'Product',method:'ai'});
 assert.deepEqual(await detectKind(item,{key:'test',send:async()=>new Response(null,{status:429})}),{kind:'Website',method:'fallback'});
 assert.deepEqual(await detectKind({...item,capture_type:'selection'},{key:'test',send}),{kind:'Text',method:'capture'});
});

test('Ollama classification uses only the loopback endpoint without credentials',async()=>{
 const {detectKind}=await import('./detect.mjs');
 const result=await detectKind({url:'https://example.org/cup'},{
   provider:'ollama',key:'unused',send:async(url,options)=>{
     assert.equal(url,'http://127.0.0.1:11434/v1/chat/completions');
     assert.equal(options.headers.Authorization,undefined);
     return Response.json({choices:[{message:{content:'{"kind":"Product"}'}}]});
   }
 });
 assert.deepEqual(result,{kind:'Product',method:'ai'});
});

test('separate title and thumbnail siblings share a destination and preview',async t=>{
 const {readPicture}=await import('./extension/picture.js');
 const target='https://store.example/item/23',source='https://cdn.example/cover.jpg';
 const img={src:source,complete:false,closest:()=>null};
 const anchor={href:target,textContent:'Camera',getAttribute:()=>null,querySelectorAll:()=>[]};
 const card={tagName:'ARTICLE',querySelectorAll:selector=>selector==='img'?[img]:[anchor]};
 img.parentElement=anchor.parentElement=card;
 globalThis.location={href:'https://store.example/list'};
 globalThis.document={baseURI:location.href,links:[anchor],images:[img],querySelector:()=>null};
 t.after(()=>{delete globalThis.document;delete globalThis.location});
 assert.equal(readPicture(target,true,'').picture_url,source);
 assert.equal(readPicture(source,false,source).destination,target);
 card.querySelectorAll=selector=>selector==='img'?[img]:[anchor,{href:'https://other.example/'}];
 assert.equal(readPicture(source,false,source).destination,undefined);
});
