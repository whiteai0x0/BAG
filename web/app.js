const kinds=Array.from(document.querySelectorAll('#kind option[value]'),option=>option.value).filter(Boolean);
const $=id=>document.getElementById(id);
const status=message=>{$('notice').textContent=message};
let register=false,shown=0,generation=0,timer;
async function api(path,method='GET',data){
 const res=await fetch('/api/'+path,{signal:AbortSignal.timeout(method==='PATCH'||path==='items'&&method==='POST'?55000:30000),method,headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
 const result=await res.json();
 if(!res.ok){if(res.status===401)screen(null);throw Error(result.error)}
 return result;
}
function screen(email){
 if(!email){$('usersPanel').hidden=true;$('usersPanel').open=false;$('userRows').replaceChildren()}
 generation++;$('auth').hidden=!!email;
 for(const id of ['collection','logout','search'])$(id).hidden=!email;
 $('account').textContent=email||'';$('grid').replaceChildren();$('search').value='';status('');
}
function element(tag,txt){const e=document.createElement(tag);e.textContent=txt;return e}
function link(item,txt){const a=element('a',txt);a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';return a}

async function manualPicture(file){
 if(!file)return;
 if(file.size>12*1024*1024)throw Error('Choose an image under 12 MB.');
 const image=await createImageBitmap(file);
 try{
   const scale=Math.min(1,400/image.width,260/image.height);
   const canvas=document.createElement('canvas');
   canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
   canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
   return canvas.toDataURL('image/jpeg',0.72);
 }finally{image.close()}
}
function card(item){
 const box=element('article','');box.className='card';
 const tile=element('div',item.domain.charAt(0).toUpperCase());tile.className='tile';
 const original=item.capture_type==='image'||item.kind==='Image'?item.url:null;
 const sources=[...new Set([item.has_picture?'/api/items/'+item.id+'/picture':null,item.picture_url,original].filter(Boolean))];
 if(sources.length){
   const image=document.createElement('img');
   image.alt='Reference picture for '+item.title;
   image.referrerPolicy='no-referrer';
   image.loading='lazy';
   const next=()=>{
     if(sources.length){image.src=sources.shift();return}
     tile.textContent='Preview unavailable';
     tile.classList.add('missing-picture');
   };
   image.onerror=next;
   tile.replaceChildren(image);
   next();
 }
 const type=document.createElement('select');type.setAttribute('aria-label','Item type for '+item.title);
 for(const kind of kinds)type.add(new Option(kind,kind,false,kind===item.kind));
 type.add(new Option('Detect again','auto'));
 type.onchange=guard(async()=>{try{const updated=await api('items/'+item.id,'PATCH',{kind:type.value});item.kind=updated.kind;type.value=updated.kind;status('Item type updated · '+updated.kind+' · '+detectionLabel(updated.detection_method))}catch(error){type.value=item.kind;throw error}});
 const title=element('h2','');title.append(link(item,item.title));
 const foot=element('footer',''),actions=element('div','');
 for(const action of ['Rename','Delete']){
 const b=element('button',action);b.onclick=guard(async()=>{
 if(action==='Rename'){const title=prompt('Edit title',item.title);if(title===null)return;await api('items/'+item.id,'PATCH',{title})}
 else{if(!confirm('Delete “'+item.title+'” from BAG?'))return;await api('items/'+item.id,'DELETE',{})}
 await list();
 });actions.append(b)}
 foot.append(link(item,'Open ↗'),actions);box.append(tile,type,element('small',item.domain),title,element('small',item.capture_type+' · '+new Date(item.captured_at).toLocaleString()),foot);
 if(item.selected_text){const passage=element('blockquote',item.selected_text);title.after(passage);tile.remove()}
 if(item.capture_type==='image' && item.source_url)foot.before(link({url:item.source_url},'Source page ↗'));
 return box;
}
async function list(append=false){
 const seq=++generation,q=$('search').value;
 const result=await api('items?q='+encodeURIComponent(q)+'&offset='+(append?shown:0));if(seq!==generation)return;
 if(!append){shown=0;$('grid').replaceChildren()}
 $('grid').append(...result.items.map(card));shown+=result.items.length;
 $('count').textContent=result.total;$('more').hidden=shown>=result.total;
 $('empty').hidden=!!result.total;$('empty').textContent=q?'No matching items. Try another title or domain.':'Your BAG is empty. Paste your first URL above, or choose “To my BAG” from the browser context menu after installing the extension.';
}
function guard(fn){return async e=>{e?.preventDefault();try{await fn()}catch(err){status(err.message==='Failed to fetch'?'BAG is offline. Reconnect and try again.':err.message)}}}
$('switchMode').onclick=()=>{register=!register;$('submitAuth').textContent=register?'Create account':'Sign in';$('switchMode').textContent=register?'Use an existing account':'Create an account';$('password').autocomplete=register?'new-password':'current-password';status(register?'Use a password with at least 12 characters.':'')};
let challenge='',adminRole='',userOffset=0;
function showCode(id){
 challenge=id;
 $('verification').hidden=!id;
 $('credentials').hidden=!!id;
 $('switchMode').hidden=!!id;
 $('code').value='';
 if(id){$('code').focus();status('Enter the six-digit code sent to '+$('email').value+'. It expires in 10 minutes.')}
}
function configureAdmin(me){
 adminRole=me.role;
 $('usersPanel').hidden=!['owner','admin'].includes(adminRole);
}
async function loadUsers(){
 const page=await api('admin/users?offset='+userOffset);
 const rows=$('userRows');rows.replaceChildren();
 for(const u of page.users){
   const row=element('p',u.email+' · '+u.role+' · '+(u.suspended?'Suspended':u.verified?'Verified':'Awaiting verification'));
   const actions=[];
   if(u.email!==$('account').textContent && u.role!=='owner' && (adminRole==='owner'||u.role==='user')){
     actions.push(u.suspended?'restore':'suspend');
     if(adminRole==='owner' && u.verified && !u.suspended)actions.push(u.role==='admin'?'demote':'promote');
   }
   for(const action of actions){
     const button=element('button',{suspend:'Suspend',restore:'Restore',demote:'Remove admin role',promote:'Make admin'}[action]);
     button.onclick=guard(async()=>{
       if(!confirm(button.textContent+' — '+u.email+'?'))return;
       await api('admin/users','POST',{id:u.id,action});await loadUsers();
     });row.append(' ',button);
   }
   rows.append(row);
 }
 $('nextUsers').hidden=!page.more;$('firstUsers').hidden=!userOffset;
}
$('usersPanel').ontoggle=guard(async()=>{if($('usersPanel').open){userOffset=0;await loadUsers()}});
$('nextUsers').onclick=guard(async()=>{userOffset+=50;await loadUsers()});
$('firstUsers').onclick=guard(async()=>{userOffset=0;await loadUsers()});
async function signedIn(){
 const me=await api('me');
 screen(me.email);configureAdmin(me);
 $('aiInfo').textContent=me.ai_enabled?'AI classifies on save. The preview uses URL rules.':'Using URL rules. AI classification is currently unavailable.';
 await list();
}
$('credentials').onsubmit=guard(async()=>{
 const result=await api(register?'register':'login','POST',{email:$('email').value,password:$('password').value});
 $('password').value='';
 if(result.challenge){showCode(result.challenge);return}
 await signedIn();
});
$('verification').onsubmit=guard(async()=>{
 await api('verify','POST',{challenge,code:$('code').value});showCode('');await signedIn();
});
$('retryCode').onclick=()=>{showCode('');$('password').focus();status('Re-enter your password and submit after one minute for a fresh code.')};
$('logout').onclick=guard(async()=>{await api('logout','POST',{});screen(null)});
function detectionLabel(method){
 return {ai:'AI',rules:'URL rules',fallback:'URL rules · AI unavailable',capture:'capture',manual:'manual'}[method]||'';
}
async function previewKind(){
 const {classify}=await import('./kinds.mjs');
 const field=$('url'),option=$('kind').options[0];
 let label='Auto-detect type';
 try{
   const url=new URL(field.value);
   if(['https:','http:'].includes(url.protocol))label='Auto-detect · '+classify(url.href);
 }catch{}
 option.textContent=label;
}
$('url').oninput=guard(previewKind);
$('add').onsubmit=guard(async()=>{const r=await api('items','POST',{url:$('url').value,kind:$('kind').value||undefined,picture:await manualPicture($('picture').files[0])});$('add').reset();$('kind').options[0].textContent='Auto-detect type';$('search').value='';await list();status(r.status==='saved'?'Added to BAG · '+r.kind+' · '+detectionLabel(r.detection_method):'Already in your BAG')});
$('more').onclick=guard(()=>list(true));
$('search').oninput=()=>{generation++;clearTimeout(timer);timer=setTimeout(guard(()=>list()),180)};
window.addEventListener('focus',guard(()=>{if(!$('collection').hidden)return list()}));
async function start(){
 const startup=$('startup');
 try{
   const user=await api('me');
   screen(user.email);configureAdmin(user);
   $('aiInfo').textContent=user.ai_enabled?'AI classifies on save. The preview uses URL rules.':'Using URL rules. AI classification is currently unavailable.';
   await list();
   startup.hidden=true;
 }catch(error){
   if(!$('auth').hidden){startup.hidden=true;return}
   startup.querySelector('h2').textContent='BAG could not open';
   status(error.name==='TimeoutError'?'The local server took too long to respond.':error.message);
 }
}
start();
