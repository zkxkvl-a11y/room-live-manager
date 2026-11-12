// ROOM LIVE: cache only static app assets; Firebase/API traffic always uses network.
const CACHE='room-live-static-v1'
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.add('/offline.html')).then(()=>self.skipWaiting()))
})
self.addEventListener('activate',event=>{
 event.waitUntil(Promise.all([
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('room-live-static-')&&k!==CACHE).map(k=>caches.delete(k)))),
  self.clients.claim()
 ]))
})
self.addEventListener('fetch',event=>{
 const request=event.request
 if(request.method!=='GET'||new URL(request.url).origin!==self.location.origin)return
 const url=new URL(request.url)
 if(url.pathname.startsWith('/__/')||url.pathname.includes('/api/'))return
 // Network first for navigation so newly deployed versions appear immediately.
 if(request.mode==='navigate'){
  event.respondWith(fetch(request).catch(()=>caches.match('/offline.html')))
  return
 }
 if(!url.pathname.startsWith('/assets/')&&!['/room-live-icon.svg','/manifest.webmanifest'].includes(url.pathname))return
 event.respondWith(fetch(request).then(response=>{
  if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(request,copy)))}
  return response
 }).catch(()=>caches.match(request)))
})
