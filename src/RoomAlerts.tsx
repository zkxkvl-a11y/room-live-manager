import { useEffect, useRef, useState } from 'react'
import type { Room } from './store-model'
import { ref, set } from 'firebase/database'
import { database } from './firebase'

type Shop={id:string;name:string}
type Group={id:string;shopId:string}
type Preferences={enabled:boolean;shopIds:string[];ten:boolean;five:boolean}
const vapidPublicKey=import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY as string|undefined
function decodeVapid(key:string){const padding='='.repeat((4-key.length%4)%4);const raw=atob((key+padding).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0))}
async function savePushSubscription(uid:string,prefs:Preferences){
  if(!('serviceWorker' in navigator)||!('PushManager' in window))throw new Error('이 기기는 백그라운드 푸시를 지원하지 않습니다.')
  if(!vapidPublicKey)throw new Error('서버 푸시 인증키가 아직 설정되지 않았습니다.')
  const registration=await navigator.serviceWorker.ready
  let subscription=await registration.pushManager.getSubscription()
  if(!subscription){subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeVapid(vapidPublicKey)})}
  const json=subscription.toJSON()
  const endpoint=subscription.endpoint
  const deviceId=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(endpoint)).then(bytes=>Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,'0')).join(''))
  await set(ref(database,'roomLivePushSubscriptions/'+uid+'/'+deviceId),{endpoint,keys:json.keys??{},shopIds:prefs.shopIds,ten:prefs.ten,five:prefs.five,enabled:prefs.enabled,updatedAt:Date.now()})
  return deviceId
}

const storageKey=(uid:string)=>'room-live-alerts-v1:'+uid
function read(uid:string):Preferences{
  try{const raw=localStorage.getItem(storageKey(uid));if(raw){const p=JSON.parse(raw) as Partial<Preferences>;return {enabled:p.enabled===true,shopIds:Array.isArray(p.shopIds)?p.shopIds.filter((x):x is string=>typeof x==='string'):[],ten:p.ten!==false,five:p.five!==false}}}catch{}
  return {enabled:false,shopIds:[],ten:true,five:true}
}
export default function RoomAlerts({uid,shops,groups,rooms,now,show,onClose}:{uid:string;shops:Shop[];groups:Group[];rooms:Room[];now:number;show:boolean;onClose:()=>void}){
  const [prefs,setPrefs]=useState<Preferences>(()=>read(uid))
  const [message,setMessage]=useState('')
  const seen=useRef(new Set<string>())
  const [pushStatus,setPushStatus]=useState('')
  const [permission,setPermission]=useState(typeof Notification==='undefined'?'unsupported':Notification.permission)
  useEffect(()=>{setPrefs(read(uid));seen.current.clear()},[uid])
  useEffect(()=>{try{localStorage.setItem(storageKey(uid),JSON.stringify(prefs))}catch{}},[uid,prefs])
  useEffect(()=>{if(typeof Notification==='undefined'||Notification.permission!=='granted'||!vapidPublicKey)return;savePushSubscription(uid,prefs).then(()=>setPushStatus('기기 푸시 등록됨')).catch(()=>setPushStatus('기기 푸시 동기화 실패'))},[uid,prefs])
  useEffect(()=>{
    if(!prefs.enabled||!prefs.shopIds.length)return
    for(const room of rooms){
      if(room.started===null||room.ends===null||room.cleaning)continue
      const shopId=groups.find(g=>g.id===room.groupId)?.shopId
      if(!shopId||!prefs.shopIds.includes(shopId))continue
      const remaining=room.ends-now
      for(const [minutes,active] of [[10,prefs.ten],[5,prefs.five]] as const){
        if(!active||remaining>minutes*60000||remaining<=(minutes-1)*60000)continue
        const key=[uid,room.uid??room.id,room.started,room.ends,minutes].join(':')
        if(seen.current.has(key))continue
        const persistedKey='room-live-alert-fired:'+key
        try{if(localStorage.getItem(persistedKey)==='1'){seen.current.add(key);continue}}catch{}
        seen.current.add(key)
        try{localStorage.setItem(persistedKey,'1')}catch{}
        const shopName=shops.find(s=>s.id===shopId)?.name??'가게'
        const body=shopName+' · '+room.id+' · 종료 '+minutes+'분 전'
        setMessage(body)
        if(typeof Notification!=='undefined'&&Notification.permission==='granted'&&document.visibilityState==='visible'){
          try{new Notification('ROOM LIVE 종료 알림',{body,tag:key})}catch{}
        }
      }
    }
  },[uid,rooms,groups,shops,now,prefs])
  async function requestPermission(){
    if(!('Notification' in window)){setMessage('이 브라우저에서는 알림을 지원하지 않습니다.');return}
    try{
      const result=await Notification.requestPermission()
      setPermission(result)
      if(result==='granted'){
        setMessage('알림 권한이 허용되었습니다.')
        try{await savePushSubscription(uid,prefs);setPushStatus('기기 푸시 등록됨')}catch(error){setPushStatus(error instanceof Error?error.message:'기기 푸시 등록 실패')}
      }
      else setMessage('알림 권한이 허용되지 않았습니다. 앱 내부 알림은 계속 사용할 수 있습니다.')
    }catch{setMessage('알림 권한 요청에 실패했습니다.')}
  }
  return <>{message&&!show&&<div className="room-alert-floating" role="status"><span>{message}</span><button type="button" onClick={()=>setMessage('')}>닫기</button></div>}{show&&<div className="overlay" onClick={onClose}><section className="modal room-alert-settings" onClick={e=>e.stopPropagation()}><div className="section"><h2>종료 알림 설정</h2><button type="button" onClick={onClose}>닫기</button></div>
    <div className="room-alert-heading"><h3>방 종료 알림</h3><span>앱 실행 중 알림</span></div>
    <p className="hint">선택한 가게의 방 종료 10분·5분 전 알림입니다. 백그라운드 푸시는 서버 발송 설정 및 기기 지원이 필요합니다. 아이폰은 홈 화면에 설치한 앱에서만 지원됩니다.</p>
    <label className="room-alert-option"><span>알림 사용</span><input type="checkbox" checked={prefs.enabled} onChange={e=>setPrefs(p=>({...p,enabled:e.target.checked}))}/></label>
    <p className="room-alert-label">알림 받을 가게</p>
    {shops.map(shop=><label className="room-alert-option" key={shop.id}><span>{shop.name}</span><input type="checkbox" checked={prefs.shopIds.includes(shop.id)} onChange={e=>setPrefs(p=>({...p,shopIds:e.target.checked?[...p.shopIds,shop.id]:p.shopIds.filter(id=>id!==shop.id)}))}/></label>)}
    <p className="room-alert-label">알림 시점</p>
    <label className="room-alert-option"><span>종료 10분 전</span><input type="checkbox" checked={prefs.ten} onChange={e=>setPrefs(p=>({...p,ten:e.target.checked}))}/></label>
    <label className="room-alert-option"><span>종료 5분 전</span><input type="checkbox" checked={prefs.five} onChange={e=>setPrefs(p=>({...p,five:e.target.checked}))}/></label>
    <div className="room-alert-actions"><button type="button" onClick={requestPermission}>기기 알림 허용·등록</button><span>{permission==='granted'?'알림 허용됨':permission==='denied'?'기기에서 차단됨':permission==='unsupported'?'지원하지 않음':'권한 확인 필요'}</span></div>
    {pushStatus&&<p className="hint" role="status">백그라운드 알림: {pushStatus}</p>}
    {message&&<div className="room-alert-notice" role="status"><span>{message}</span><button type="button" onClick={()=>setMessage('')}>닫기</button></div>}
  </section></div>}</>
}
