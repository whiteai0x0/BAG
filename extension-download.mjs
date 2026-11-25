import {zipSync,strToU8} from 'fflate';
import files from './extension-bundle.json';
export function downloadExtension(origin){
 const archive=Object.fromEntries(Object.entries(files).map(([name,base64])=>[name,Buffer.from(base64,'base64')]));
 const manifest=JSON.parse(archive['manifest.json']);
 manifest.host_permissions=[origin+'/*'];
 archive['manifest.json']=strToU8(JSON.stringify(manifest,null,2));
 archive['client.js']=strToU8(archive['client.js'].toString().replace(/^export const origin=.*;$/m,'export const origin='+JSON.stringify(origin)+';'));
 return new Response(zipSync(archive,{level:0}),{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="bag-extension.zip"','Cache-Control':'no-store'}});
}
