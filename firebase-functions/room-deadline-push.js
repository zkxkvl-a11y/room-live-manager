const {onSchedule}=require('firebase-functions/v2/scheduler')
const {defineSecret}=require('firebase-functions/params')
const {getDatabase}=require('firebase-admin/database')
const webpush=require('web-push')
const vapidPrivate=defineSecret('ROOM_LIVE_VAPID_PRIVATE')
const vapidPublic=defineSecret('ROOM_LIVE_VAPID_PUBLIC')
const vapidContact=defineSecret('ROOM_LIVE_VAPID_CONTACT')
const list=value=>Array.isArray(value)?value:Object.values(value||{})
exports.roomDeadlinePush=onSchedule({schedule:'every 1 minutes',timeZone:'Asia/Seoul',region:'asia-southeast1',secrets:[vapidPrivate,vapidPublic,vapidContact],timeoutSeconds:60},async()=>{
 const db=getDatabase()
 const [opsSnap,legacySnap,subsSnap]=await Promise.all([db.ref('roomLiveV2/operations').get(),db.ref('roomLive').get(),db.ref('roomLivePushSubscriptions').get()])
 const source=opsSnap.exists()?opsSnap.val():legacySnap.val()
 if(!source)return
 const groups=list(source.groups),rooms=list(source.rooms),subs=subsSnap.val()||{},now=Date.now()
 webpush.setVapidDetails(vapidContact.value(),vapidPublic.value(),vapidPrivate.value())
 const allowed={}
 for(const [uid,devices] of Object.entries(subs)){
   const role=(await db.ref('roomLiveAccess/'+uid).get()).val()
   if(role==='worker'||role==='staff'||role==='observer'||uid==='P4ksHlEQiqNhQRRHKdPRAaE8Srb2')allowed[uid]=devices
 }
 for(const room of rooms){
  if(room.cleaning||!Number.isFinite(room.ends)||!Number.isFinite(room.started))continue
  const shopId=groups.find(g=>g.id===room.groupId)?.shopId
  if(!shopId)continue
  const remaining=room.ends-now
  for(const minutes of [10,5]){
   if(remaining>minutes*60000||remaining<=(minutes-1)*60000)continue
   const id=String(room.uid||room.id).replace(/[^a-zA-Z0-9_-]/g,'_')
   const runId=String(room.runStartedAt||room.started)
   const marker=db.ref('roomLivePushSent/'+id+'/'+runId+'/'+room.ends+'/'+minutes)
   const claim=await marker.transaction(current=>current===null?now:undefined,undefined,false)
   if(!claim.committed)continue
   for(const [uid,devices] of Object.entries(allowed)){
    for(const [deviceId,device] of Object.entries(devices||{})){
     if(!device?.enabled||!device.shopIds?.includes(shopId)||!(minutes===10?device.ten:device.five))continue
     if(!device.endpoint||!device.keys?.auth||!device.keys?.p256dh)continue
     try{
      await webpush.sendNotification({endpoint:device.endpoint,keys:device.keys},JSON.stringify({title:'ROOM LIVE 종료 알림',body:room.id+' · 종료 '+minutes+'분 전',tag:'room-'+id+'-'+minutes,url:'/'}),{TTL:120,urgency:'high'})
     }catch(error){
      if(error.statusCode===404||error.statusCode===410)await db.ref('roomLivePushSubscriptions/'+uid+'/'+deviceId).remove()
      else console.error('Push failed',error.statusCode||String(error))
     }
    }
   }
  }
 }
})
