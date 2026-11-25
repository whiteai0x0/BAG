import {request,origin,captureWithPicture} from './client.js';
const $=id=>document.getElementById(id);
$('dashboard').href=origin;
async function render(){
 const {email}=await chrome.storage.local.get('email');
 $('signed').hidden=!email;$('login').hidden=!!email;$('account').textContent=email||'Sign in with your BAG account. Create one in the dashboard.';
 if(!email)return;
 const {items}=await request('items');$('recent').replaceChildren();
 for(const item of items.slice(0,5)){const a=document.createElement('a');a.href=item.url;a.target='_blank';a.rel='noreferrer';a.textContent=item.title;$('recent').append(a)}
 if(!items.length)$('recent').textContent='Your first save will appear here.';
}
function run(fn){return async e=>{e?.preventDefault();try{await fn()}catch(error){$('status').textContent=error.message==='Failed to fetch'?'Offline. Reconnect and retry.':error.message;if(!(await chrome.storage.local.get('email')).email)await render()}}}
$('login').onsubmit=run(async()=>{const credentials=await request('login',{email:$('email').value,password:$('pass').value,client:'extension'});await chrome.storage.local.set(credentials);$('pass').value='';$('status').textContent='';await render()});
$('save').onclick=run(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});const r=await request('items',await captureWithPicture({},tab));$('status').textContent=r.status==='saved'?'Added to BAG · '+r.kind:'Already in your BAG';await render()});
$('logout').onclick=run(async()=>{await request('logout',{});await chrome.storage.local.remove(['token','email','last']);$('status').textContent='';await render()});
$('status').textContent=(await chrome.storage.local.get('last')).last||'';
await chrome.action.setBadgeText({text:''});await run(render)();

try {
 const menu = await chrome.runtime.sendMessage({type:'check-menu'});
 if (!menu?.ready) throw Error(menu?.error || 'No response');
 $('menuStatus').textContent = 'Right-click menu ready on HTTP and HTTPS pages.';
} catch (error) {
 $('menuStatus').textContent = 'Menu registration failed. Reload BAG in chrome://extensions. ' + error.message;
}
