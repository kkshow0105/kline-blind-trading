const VERSION="1.0.1";
const scope=new URL(self.registration.scope);
const prefix="kline-blind:"+scope.pathname+":";
const cacheName=prefix+VERSION;
const absolute=path=>new URL(path,scope).href;
const files=["index.html","style.css","app.mjs","engine.mjs","storage.mjs","chart.mjs","share.mjs","pwa.mjs",
  "manifest.webmanifest","icons/icon-192.png","icons/icon-512.png","icons/apple-touch-icon.png","data/sample.json"];
const paths=new Set(files.map(absolute));

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(cacheName).then(cache=>
    cache.addAll(files.map(file=>new Request(absolute(file),{cache:"reload"})))));
});
self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    for(const key of await caches.keys()){
      if(key.startsWith(prefix) && key!==cacheName)await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener("message",event=>{
  if(event.data?.type==="activate" && event.data.version===VERSION)event.waitUntil(self.skipWaiting());
});
self.addEventListener("fetch",event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=="GET" || url.origin!==scope.origin || !url.pathname.startsWith(scope.pathname))return;
  if(url.pathname===new URL("release.json",scope).pathname){
    event.respondWith(fetch(event.request,{cache:"no-store"}));
    return;
  }
  const target=event.request.mode==="navigate" ? absolute("index.html") : url.href;
  if(!paths.has(target))return;
  event.respondWith(caches.open(cacheName).then(async cache=>
    (await cache.match(target)) ?? fetch(event.request)));
});
