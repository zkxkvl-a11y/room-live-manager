/* ROOM LIVE PATCH 05: notification-only service worker; no offline caching. */
self.addEventListener('push',event=>{
  if(!event.data)return;
  let payload;
  try{payload=event.data.json()}catch{return}
  const title=typeof payload.title==='string'?payload.title:'ROOM LIVE';
  const body=typeof payload.body==='string'?payload.body:'새로운 알림이 있습니다.';
  const tag=typeof payload.tag==='string'?payload.tag:'room-live';
  event.waitUntil(self.registration.showNotification(title,{
    body,tag,icon:'/favicon.ico',data:{url:'/'},renotify:false
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{
    const client=clients.find(c=>new URL(c.url).origin===self.location.origin);
    if(client)return client.focus();
    return self.clients.openWindow('/');
  }));
});
