import {readPicture} from './picture.js';
export const origin='http://127.0.0.1:8787';
export async function request(path,data){
 const {token}=await chrome.storage.local.get('token');
 const response=await fetch(origin+'/api/'+path,{method:data?'POST':'GET',credentials:'omit',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:data?JSON.stringify(data):undefined});
 const result=await response.json();
 if(!response.ok){if(response.status===401)await chrome.storage.local.remove(['token','email']);throw Error(result.error)}
 return result;
}
export function capture(info,tab){
 const source=info.frameUrl||info.pageUrl||tab?.url;
 const image=info.mediaType==='image'&&!/^https?:\/\//i.test(info.linkUrl||'');
 const selection=!image && info.selectionText?.trim();
 const url=image?info.srcUrl:selection?source:info.linkUrl||source;
 if(!url||!/^https?:\/\//i.test(url))throw Error('Choose an HTTP or HTTPS page or link.');
 if(image)return {url,source_url:source,capture_type:'image',kind:'Image',captured_at:new Date().toISOString()};
 if(selection)return {url,selected_text:info.selectionText,captured_title:tab?.title||'',capture_type:'selection',kind:'Text',captured_at:new Date().toISOString()};
 return {url,...(info.mediaType==='image'&&info.linkUrl&&/^https?:\/\//i.test(info.srcUrl)?{picture_url:info.srcUrl}:{}),captured_title:info.linkUrl?'':tab?.title||'',capture_type:info.linkUrl?'link':'page',captured_at:new Date().toISOString()};
}

export async function captureWithPicture(info,tab){
 const record=capture(info,tab);
 if(record.capture_type==='selection')return record;
 try{
   const [result]=await chrome.scripting.executeScript({
     target:{tabId:tab.id,frameIds:[info.frameId??0]},func:readPicture,
     args:[record.url,record.capture_type==='link',info.srcUrl||'']
   });
   if(result?.result){
     const {destination,...metadata}=result.result;
     if(destination && record.capture_type==='image'){
       record.url=destination;record.capture_type='link';
       delete record.kind;delete record.source_url;
     }
     Object.assign(record,metadata);
   }
 }catch{}
 if(record.capture_type!=='link' && ['video','audio','image'].includes(info.mediaType))
   record.kind={video:'Video',audio:'Audio',image:'Image'}[info.mediaType];
 return record;
}
