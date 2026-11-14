import type { User } from 'firebase/auth'

export type PushState='unsupported'|'blocked'|'idle'|'enabled'
export const pushAvailable=()=>typeof window!=='undefined'&&window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window
export function pushState():PushState{
  if(!pushAvailable())return 'unsupported'
  if(Notification.permission==='denied')return 'blocked'
  return Notification.permission==='granted'?'enabled':'idle'
}
function decodeKey(base64:string):Uint8Array<ArrayBuffer>{
  const normalized=base64.replace(/-/g,'+').replace(/_/g,'/')
  const decoded=atob(normalized.padEnd(Math.ceil(normalized.length/4)*4,'='))
  const bytes=new Uint8Array(new ArrayBuffer(decoded.length))
  for(let i=0;i<decoded.length;i++)bytes[i]=decoded.charCodeAt(i)
  return bytes
}
// A subscription is never sent to an unconfigured or unauthenticated endpoint.
export async function subscribePush(user:User,workerUrl:string,vapidKey:string):Promise<void>{
  if(!pushAvailable())throw Error('이 기기에서는 웹 푸시를 지원하지 않습니다.')
  if(!workerUrl.startsWith('https://')||!vapidKey)throw Error('알림 서버 설정이 필요합니다.')
  const permission=await Notification.requestPermission()
  if(permission!=='granted')throw Error('알림 권한이 허용되지 않았습니다.')
  const registration=await navigator.serviceWorker.register('/room-live-sw.js')
  const subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeKey(vapidKey)})
  const response=await fetch(workerUrl.replace(/\/$/,'')+'/subscriptions',{
    method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+await user.getIdToken()},
    body:JSON.stringify({subscription:subscription.toJSON()})
  })
  if(!response.ok){await subscription.unsubscribe();throw Error('알림 서버 등록 실패 ('+response.status+')')}
}
