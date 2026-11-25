export const kinds=['Website','Video','Game','Person / Contact','Product','Article','Audio','Image','Document','Place','Software','Text'];
export function classify(url){
 const {hostname,pathname,searchParams}=new URL(url),p=pathname.toLowerCase();
 const host=name=>hostname===name||hostname.endsWith('.'+name);
 if(/\.(mp4|webm|mov)$/.test(p)||host('youtu.be')||host('youtube.com')&&/^\/(watch|shorts\/|live\/|embed\/)/.test(p)||host('vimeo.com')&&/^\/\d/.test(p))return 'Video';
 if(host('tiktok.com')&&/\/video\/\d+/.test(p)||host('instagram.com')&&/^\/reels?\/[^/]+/.test(p)||host('facebook.com')&&/^\/(reel|watch|videos)\//.test(p))return 'Video';
 if(host('github.com')&&/^\/[^/]+\/[^/]+\/releases(?:\/|$)/.test(p))return 'Software';
 if(host('amazon.com')&&p.startsWith('/gp/product/')||host('etsy.com')&&p.startsWith('/listing/')||host('ebay.com')&&p.startsWith('/itm/'))return 'Product';
 if(host('maps.app.goo.gl')&&p!=='/')return 'Place';
 if(host('store.steampowered.com')&&p.startsWith('/app/')||host('itch.io')&&p!=='/'||/\/games?\/[^/]/.test(p))return 'Game';
 const appListing=(host('apps.apple.com') && /\/app\/(?:[^/]+\/)?id\d+\/?$/.test(p))
   || (host('play.google.com') && p==='/store/apps/details' && Boolean(searchParams.get('id')))
   || (host('chromewebstore.google.com') && p.startsWith('/detail/'));
 const packageListing=(host('pypi.org') && /^\/project\/[^/]+/.test(p))
   || (host('npmjs.com') && /^\/package\/[^/]+/.test(p));
 if(appListing || packageListing || /\.(msi|exe|dmg|apk|appimage|deb|rpm)$/.test(p))return 'Software';
 if(host('linkedin.com')&&p.startsWith('/in/')||/\/(people|profile|contact)\/[^/]/.test(p)||p.endsWith('.vcf'))return 'Person / Contact';
 if(/\/(dp|products?|sku)\/[^/]/.test(p))return 'Product';
 if(/\.(mp3|wav|ogg|flac)$/.test(p)||host('open.spotify.com')||host('podcasts.apple.com'))return 'Audio';
 if(/\.(jpg|jpeg|webp|png|gif|avif)$/.test(p))return 'Image';
 if(/\.(pdf|docx?|pptx?|xlsx?)$/.test(p)||host('docs.google.com'))return 'Document';
 if(host('maps.google.com')||host('google.com')&&p.startsWith('/maps/')||host('openstreetmap.org')&&/^\/(node|way|relation)\//.test(p))return 'Place';
 if(/\/(articles?|blog|posts?|news)\/[^/]/.test(p)||host('wikipedia.org')&&p.startsWith('/wiki/'))return 'Article';
 return 'Website';
}
