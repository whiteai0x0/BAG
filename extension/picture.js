// This function runs in the isolated world of the clicked frame. Read only
// existing, loaded images. Never fetch a linked destination to build its card.
export function readPicture(target,link,source){
 const page=new URL(location.href);
 if(!link && !source && page.href!==target)return null;
 const hints={};
 if(!link && !source && page.href===target){
   const og=(document.querySelector('meta[property="og:type"]')?.content||'').toLowerCase();
   const hint={article:'Article',product:'Product',profile:'Person / Contact',game:'Game',book:'Document'}[og];
   if(typeof hint==='string')hints.detected_kind=hint;
   if(og.startsWith('video.'))hints.detected_kind='Video';
   if(og.startsWith('music.'))hints.detected_kind='Audio';
 }
 const images=Array.from(document.images);
 const meta=document.querySelector('meta[property="og:image"]')?.content;
 const absolute=value=>{if(!value)return '';try{return new URL(value,document.baseURI).href}catch{return ''}};
 // A card may put its title, thumbnail and transparent link overlay in siblings.
 // Walk only small, unambiguous groups; never pick the first photo in a feed.
 const httpHref=a=>/^https?:\/\//i.test(a?.href||'')?a.href:null;
 function nearby(node,find){
   for(let parent=node?.parentElement,depth=0;parent&&depth<5;parent=parent.parentElement,depth++){
     if(['BODY','HTML','MAIN','NAV'].includes(parent.tagName))break;
     const links=Array.from(parent.querySelectorAll('a[href]')).filter(httpHref);
     const destinations=new Set(links.map(a=>a.href));
     if(destinations.size>1)break;
     const result=find(parent,links);
     if(result)return result;
   }
 }
 const exact=source?images.filter(img=>img.currentSrc===source||img.src===source):[];
 if(!link && exact.length===1){
   const img=exact[0];
   const destination=httpHref(img.closest('a[href]')) || nearby(img,(parent,links)=>
     parent.querySelectorAll('img').length===1 && links[0]?.href);
   if(destination){
     hints.destination=destination;target=destination;link=true;
     hints.picture_url=source;
   }
 }
 const anchors=link?Array.from(document.links).filter(a=>a.href===target):[];
 const linkedImages=anchors.flatMap(a=>Array.from(a.querySelectorAll('img')));
 if(link && !exact.length && !linkedImages.length){
   for(const anchor of anchors){
     const img=nearby(anchor,parent=>{
       const imgs=parent.querySelectorAll('img');
       return imgs.length===1?imgs[0]:null;
     });
     if(img){linkedImages.push(img);break}
   }
 }
 if(link){
   const label=anchors.map(a=>a.getAttribute('aria-label')||a.textContent?.trim()||a.title).find(Boolean);
   if(label)hints.captured_title=label.slice(0,512);
 }
 const candidates=images.filter(image=>{
   if(link)return exact.length?exact.includes(image):linkedImages.includes(image);
   if(source)return image.currentSrc===source||image.src===source;
   return image.currentSrc===absolute(meta)||image.closest('main,article')||document.contentType.startsWith('image/')||image.naturalWidth>=320;
 }).filter(image=>image.complete&&image.naturalWidth>=80&&image.naturalHeight>=48);
 for(const image of candidates.slice(0,8)){
   try{
     const canvas=document.createElement('canvas');
     const scale=Math.min(1,400/image.naturalWidth,260/image.naturalHeight);
     canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
     canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
     canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
     return {...hints,picture:canvas.toDataURL('image/jpeg',0.72)};
   }catch{}
 }
 const linked=linkedImages[0];
 const candidate=source || (link?(linked?.currentSrc||linked?.src||linked?.getAttribute('data-src')):null)
   || candidates[0]?.currentSrc || (!link && (meta||document.querySelector('meta[name="twitter:image"]')?.content));
 const picture_url=absolute(candidate);
 return /^https?:\/\//i.test(picture_url)?{...hints,picture_url}:hints;
}
