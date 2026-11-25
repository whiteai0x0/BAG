import {captureWithPicture,request} from './client.js';
const menu = {
  id: 'bag',
  title: 'To my BAG',
  contexts: ['page', 'link', 'image', 'video', 'audio', 'selection', 'editable', 'frame'],
  documentUrlPatterns: ['http://*/*', 'https://*/*']
};

let pending;
function ensureMenu() {
  if (!pending) pending = new Promise((resolve, reject) => {
    const { id, ...properties } = menu;
    chrome.contextMenus.update(id, properties, () => {
      if (!chrome.runtime.lastError) return resolve();
      chrome.contextMenus.create(menu, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      });
    });
  }).finally(() => { pending = undefined });
  return pending;
}

function initialize() {
  ensureMenu().catch(error => console.error('BAG menu registration failed', error));
}
chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'check-menu' || sender.url !== chrome.runtime.getURL('popup.html')) return;
  ensureMenu().then(() => respond({ready:true}), error => respond({error:error.message}));
  return true;
});
chrome.contextMenus.onClicked.addListener(async(info,tab)=>{
 if(info.menuItemId!=='bag')return;
 let text,badge;
 try{const r=await request('items',await captureWithPicture(info,tab));text=r.status==='saved'?'Added to BAG · '+r.kind:'Already in your BAG';badge=r.status==='saved'?'✓':'='}
 catch(e){text=e.message;badge='!'}
 await chrome.storage.local.set({last:text});
 await chrome.action.setTitle({title:text});
 await chrome.action.setBadgeText({text:badge});
});
