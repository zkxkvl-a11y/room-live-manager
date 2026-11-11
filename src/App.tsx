import { useEffect, useRef, useState } from 'react'
import './App.css'
import type { FormEvent } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { onValue, runTransaction, ref, set, remove } from 'firebase/database'
import { auth, database, roomLiveRef, ADMIN_UID } from './firebase'

type Attendance={id:string;name:string;working:boolean}
type Shop = { id: string; name: string }
type Group = { id: string; shopId: string; name: string; layout: (string | null)[] }
type Room = { id: string; uid?: string; groupId?: string; started: number | null; ends: number | null; tags: string[] }
type Log = { id: string; at: number; room: string; roomUid?: string; action: string }
type Visit = { id: string; tag: string; room: string; roomUid?: string; entered: number; exited: number | null }
type Session = { id: string; room: string; roomUid?: string; started: number; ended: number | null }
type Payment = { id: string; room: string; roomUid?: string; at: number; amount: number; method: '카드' | '현금' | '이체' | '미수'; sessionId: string | null; manager?: string; memo?: string; shopId?: string; groupId?: string; wari?: string; wt?: string }
type Store = { rooms: Room[]; tags: string[]; attendance?:Attendance[]; logs: Log[]; visits: Visit[]; sessions: Session[]; payments: Payment[]; layout?: (string | null)[]; shops?: Shop[]; groups?: Group[]; showWari?: boolean; showWt?: boolean }
const seed: Store = { rooms: Array.from({ length: 6 }, (_, i) => ({ id: `${i + 1}T`, started: null, ends: null, tags: [] })), tags: ['A01', 'A02', 'A03', 'A04', 'A05', 'A06'], logs: [], visits: [], sessions: [], payments: [], layout: [], shops: [{ id: 'shop-a', name: '가게 A' }, { id: 'shop-b', name: '가게 B' }], groups: [{ id: 'group-default', shopId: 'shop-a', name: '기본 묶음', layout: [] }], showWari: true, showWt: true }
function read(): Store {
  try {
    const raw = localStorage.getItem('room-live-v1')
    if (!raw) return {...seed,rooms:seed.rooms.map(r=>({...r,uid:crypto.randomUUID(),groupId:'group-default'})),attendance:seed.tags.map(name=>({id:crypto.randomUUID(),name,working:false}))}
    const old = JSON.parse(raw) as Store
    const shops = old.shops?.length ? old.shops : seed.shops!
    const groups = old.groups?.length ? old.groups : seed.groups!
    const rooms = (old.rooms ?? seed.rooms).map(r => ({ ...r, uid: r.uid ?? crypto.randomUUID(), groupId: r.groupId ?? groups[0].id }))
    const byName = (name:string) => rooms.find(r=>r.id===name)
    const layout = old.layout?.length ? old.layout : rooms.map(r=>r.id)
    const migrated = groups.map((g,i)=>({...g,layout:(g.layout?.length ? g.layout : i===0 ? layout : []).map(key=>key===null?null:rooms.find(r=>r.uid===key&&r.groupId===g.id)?.uid??rooms.find(r=>r.id===key&&r.groupId===g.id)?.uid??null)}))
    const enrich = <T extends {room:string;roomUid?:string},>(items:T[])=>items.map(x=>({...x,roomUid:x.roomUid??byName(x.room)?.uid}))
    const payments = (old.payments??[]).map(p=>({...p,roomUid:p.roomUid??byName(p.room)?.uid,groupId:p.groupId??byName(p.room)?.groupId??groups[0].id,shopId:p.shopId??groups.find(g=>g.id===(byName(p.room)?.groupId??groups[0].id))?.shopId??shops[0].id}))
    const legacyNames=[...new Set([...(old.tags??seed.tags),...rooms.flatMap(r=>r.tags),...(old.visits??[]).map(v=>v.tag)])]
    const attendance=old.attendance??legacyNames.map(name=>({id:crypto.randomUUID(),name,working:rooms.some(r=>r.tags.includes(name))}))
    const helperId=(tag:string)=>attendance.find(h=>h.id===tag||h.name===tag)?.id??tag
    const mappedRooms=rooms.map(r=>({...r,tags:r.tags.map(helperId)}))
    const mappedVisits=enrich(old.visits??[]).map(v=>({...v,tag:helperId(v.tag)}))
    return {...seed,...old,rooms:mappedRooms,shops,groups:migrated,payments,logs:enrich(old.logs??[]),visits:mappedVisits,sessions:enrich(old.sessions??[]),attendance}

  } catch { return seed }
}
// Realtime Database omits empty arrays and null-only fields; restore the UI's array contract.
function normalizeRemote(raw: Store): Store {
  const array = <T,>(value:unknown):T[] =>
    Array.isArray(value) ? value as T[] :
    value && typeof value==='object' ? Object.values(value) as T[] : []
  const rooms=array<Room>(raw.rooms).map(r=>({...r,tags:array<string>(r.tags),started:r.started??null,ends:r.ends??null}))
  const groups=array<Group>(raw.groups).map(g=>({...g,layout:Array.isArray(g.layout)?g.layout:[]}))
  return {...seed,...raw,rooms,tags:array<string>(raw.tags),attendance:array<Attendance>(raw.attendance),logs:array<Log>(raw.logs),visits:array<Visit>(raw.visits),sessions:array<Session>(raw.sessions),payments:array<Payment>(raw.payments),shops:array<Shop>(raw.shops),groups}
}
const format = (ms: number) => { const n = Math.max(0, Math.ceil(ms / 1000)); return [Math.floor(n / 3600), Math.floor(n % 3600 / 60), n % 60].map(x => String(x).padStart(2, '0')).join(':') }
const date = (n: number) => new Date(n).toLocaleString('ko-KR', { hour12: false })
export default function App() {
  const [store, setStoreState] = useState<Store>(read)
  const [account, setAccount] = useState<User|null>(null)
  const [role,setRole]=useState<'admin'|'worker'|'observer'|'pending'>('pending')
  const [approvedStaff,setApprovedStaff]=useState<Record<string,string>>({})
  const isAdmin=account?.uid===ADMIN_UID
  const canOperate=role==='admin'||role==='worker'
  const [authLoading, setAuthLoading] = useState(true)
  const [remoteState, setRemoteState] = useState<'loading'|'empty'|'ready'|'error'>('loading')
  const [remoteError, setRemoteError] = useState('')
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)
  const localInitial = useRef<Store>(read())
  const readyRef = useRef(false)
  const transactionQueue = useRef<Promise<unknown>>(Promise.resolve())
  function setStore(update:Store|((previous:Store)=>Store)) {
    if(!canOperate){alert('현황 옵저버는 조회만 가능합니다.');return}
    if(!readyRef.current){alert('서버 데이터 연결이 완료된 후 수정할 수 있습니다.');return}
    const operation=async()=>{
      try {
        const result=await runTransaction(roomLiveRef,current=>{
          if(current===null)return
          const previous=normalizeRemote(current as Store)
          return typeof update==='function'?update(previous):update
        },{applyLocally:false})
        if(!result.committed)throw Error('서버에 저장되지 않았습니다.')
      }catch(error){setRemoteError('저장 실패: '+(error instanceof Error?error.message:String(error)))}
    }
    transactionQueue.current=transactionQueue.current.then(operation,operation)
  }
  const [now, setNow] = useState(Date.now())
  const [page, setPage] = useState<'rooms' | 'attendance' | 'logs' | 'payments' | 'settings'>('rooms')
  const [detail, setDetail] = useState<string | null>(null)
  const [adjust, setAdjust] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const [editing, setEditing] = useState(false)
  const [moving, setMoving] = useState<string | null>(null)
  const [day, setDay] = useState('')
  const [viewSession, setViewSession] = useState<string | null>(null)
  const [historyRoom, setHistoryRoom] = useState<string | null>(null)
  const [checkout, setCheckout] = useState<string | null>(null)
  const [payMethod, setPayMethod] = useState<Payment['method'] | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payManager, setPayManager] = useState('')
  const [payMemo, setPayMemo] = useState('')
  const [payWari, setPayWari] = useState('')
  const [payWt, setPayWt] = useState('')
  const [shopTab, setShopTab] = useState('all')
  const [payShopTab, setPayShopTab] = useState('all')
  const [payGroup, setPayGroup] = useState('all')
  const [payDay, setPayDay] = useState('')
  const [memoOnly, setMemoOnly] = useState(false)
  const [newRoomGroup,setNewRoomGroup]=useState<string|null>(null)
  const [newRoomName,setNewRoomName]=useState('')
  const [roomError,setRoomError]=useState('')
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null)
  const held = useRef(false)
  const tap = useRef<{ room: string; time: number } | null>(null)
  useEffect(() => { const interval = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(interval) }, [])
  useEffect(()=>{
    return onAuthStateChanged(auth,user=>{
      readyRef.current=false
      setAccount(user)
      setRole(user?.uid===ADMIN_UID?'admin':'pending')
      setAuthLoading(false)
      setRemoteState('loading')
    })
  },[])
  useEffect(()=>{if((!isAdmin&&page==='settings')||(role==='observer'&&page!=='rooms'))setPage('rooms')},[isAdmin,page,role])
  useEffect(()=>{
    if(!account||role==='pending'||role==='observer')return
    setRemoteError('')
    const unsubscribe=onValue(roomLiveRef,snapshot=>{
      const raw=snapshot.val() as Store|null
      const data=raw?normalizeRemote(raw):null
      readyRef.current=Boolean(data)
      if(data){if(!localStorage.getItem('room-live-precloud-backup-v1')){const previous=localStorage.getItem('room-live-v1');if(previous)localStorage.setItem('room-live-precloud-backup-v1',previous)}setStoreState(data);setRemoteState('ready');localStorage.setItem('room-live-v1',JSON.stringify(data))}
      else setRemoteState('empty')
    },error=>{readyRef.current=false;setRemoteState('error');setRemoteError(error.message)})
    return ()=>{readyRef.current=false;unsubscribe()}
  },[account,role])
  useEffect(()=>{
    if(!account||isAdmin)return
    const unsub=onValue(ref(database,'roomLiveAccess/'+account.uid),snapshot=>{
      setRole(snapshot.val()==='worker'||snapshot.val()==='staff'?'worker':snapshot.val()==='observer'?'observer':snapshot.val()==='admin'?'admin':'pending')
    },error=>{setRole('pending');setRemoteError('권한 확인 실패: '+error.message)})
    return unsub
  },[account,isAdmin])
  useEffect(()=>{
    if(!isAdmin)return
    const unsub=onValue(ref(database,'roomLiveAccess'),snapshot=>{
      setApprovedStaff((snapshot.val()??{}) as Record<string,string>)
    },error=>setRemoteError('직원 목록 조회 실패: '+error.message))
    return unsub
  },[isAdmin])
  async function addStaff(){
    if(!isAdmin)return
    const uid=prompt('Firebase Authentication 사용자 UID 입력 (28자)')?.trim()
    if(!uid)return
    if(!/^[a-zA-Z0-9]{20,128}$/.test(uid)||uid===ADMIN_UID){alert('UID 형식을 확인해 주세요.');return}
    const choice=prompt('권한 입력: observer (현황 옵저버), worker (실무자), admin (관리자)','worker')?.trim()
    if(!choice||!['observer','worker','admin'].includes(choice))return
    if(choice==='observer'){alert('옵저버 서버 조회 분리 전에는 승인할 수 없습니다. 다음 보안 패치에서 활성화됩니다.');return}
    if(choice==='admin'){alert('추가 관리자 서버 권한 분리 전에는 승인할 수 없습니다. 최초 관리자만 유지됩니다.');return}
    if(!confirm(uid+' 계정을 실무자로 승인할까요?'))return
    try{await set(ref(database,'roomLiveAccess/'+uid),'worker')}
    catch(error){setRemoteError('직원 승인 실패: '+String(error))}
  }
  async function changeStaffRole(uid:string){
    if(!isAdmin)return
    const choice=prompt('변경할 권한 (worker / observer / admin)',approvedStaff[uid]??'worker')?.trim()
    if(!choice||!['worker','observer','admin'].includes(choice))return
    if(choice!=='worker'){alert('옵저버와 추가 관리자 권한은 서버 보안 분리 후 활성화할 수 있습니다.');return}
    if(!confirm('해당 계정을 실무자로 설정할까요?'))return
    try{await set(ref(database,'roomLiveAccess/'+uid),'worker')}catch(error){setRemoteError('권한 변경 실패: '+String(error))}
  }
  async function revokeStaff(uid:string){
    if(!isAdmin||!confirm('이 직원의 서버 접근 권한을 해제할까요?'))return
    try{await remove(ref(database,'roomLiveAccess/'+uid))}
    catch(error){setRemoteError('승인 해제 실패: '+String(error))}
  }
  async function login(event:FormEvent<HTMLFormElement>){
    event.preventDefault()
    setRemoteError('')
    setLoginBusy(true)
    try{await signInWithEmailAndPassword(auth,loginEmail.trim(),loginPassword);setLoginPassword('')}
    catch(error){setRemoteError('로그인 실패: '+(error instanceof Error?error.message:String(error)))}
    finally{setLoginBusy(false)}
  }
  async function importLocal(){
    if(!isAdmin)return
    if(!confirm('이 휴대폰의 기존 데이터를 최초 서버 데이터로 등록할까요? 서버에 데이터가 이미 있다면 덮어쓰지 않습니다.'))return
    setRemoteError('')
    try{
      const result=await runTransaction(roomLiveRef,current=>current===null?normalizeRemote(localInitial.current):undefined,{applyLocally:false})
      if(!result.committed)alert('서버에 이미 데이터가 존재합니다. 기존 데이터를 덮어쓰지 않았습니다.')
    }catch(error){setRemoteError('최초 등록 실패: '+(error instanceof Error?error.message:String(error)))}
  }
  const roomKey=(r:Room)=>r.uid??r.id
  const roomName=(uid:string)=>store.rooms.find(r=>roomKey(r)===uid)?.id??uid
  const record = (uid: string, action: string): Log => ({ id: crypto.randomUUID(), at: Date.now(), room:roomName(uid), roomUid:uid, action })
  const sameRoom=(x:{room:string;roomUid?:string},uid:string)=>x.roomUid?x.roomUid===uid:x.room===roomName(uid)
  const attendance=store.attendance??[]
  const waiting=attendance.filter(h=>h.working&&!store.rooms.some(r=>r.tags.includes(h.id)))
  const helperName=(id:string)=>attendance.find(h=>h.id===id)?.name??id
  const shops = store.shops ?? seed.shops!
  const shopFor=(r:Room)=>groups.find(g=>g.id===r.groupId)?.shopId
  const duplicated=(name:string,shopId:string,exclude?:string)=>store.rooms.some(r=>r.id.toLocaleUpperCase()===name.toLocaleUpperCase()&&shopFor(r)===shopId&&roomKey(r)!==exclude)
  const renameShop=(id:string)=>{const current=shops.find(x=>x.id===id);if(!current)return;let name=prompt('가게 이름',current.name)?.trim();while(name){if(shops.some(x=>x.id!==id&&x.name.toLocaleLowerCase()===name!.toLocaleLowerCase())){alert('이미 등록된 가게 이름입니다. 다른 이름을 입력해 주세요.');name=prompt('가게 이름 다시 입력',name)?.trim();continue}setStore(v=>({...v,shops:(v.shops??[]).map(x=>x.id===id?{...x,name}:x)}));break}}
  const groups = store.groups ?? seed.groups!
  const openCheckout = (id: string) => { setCheckout(id); setPayMethod(null); setPayAmount(''); setPayManager(''); setPayMemo(''); setPayWari(''); setPayWt(''); setDetail(null) }
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  function changeTime(id: string, minutes: number) {
    setStore(s => {
      const room = s.rooms.find(r => roomKey(r) === id)
      if (!room || (!room.ends && minutes < 0)) return s
      const time = Date.now()
      return { ...s, rooms: s.rooms.map(r => roomKey(r) !== id ? r : { ...r, started: r.started ?? time, ends: Math.max(time, (r.ends ?? time) + minutes * 60000) }), logs: [record(id, `시간 ${minutes > 0 ? '+' : ''}${minutes}분 · 변경 전 ${room.ends ? format(room.ends - time) : '대기'} → 변경 후 ${format(Math.max(time, (room.ends ?? time) + minutes * 60000) - time)}`), ...s.logs], sessions: room.started ? s.sessions : [{ id: crypto.randomUUID(), room: room.id, roomUid:id, started: time, ended: null }, ...s.sessions] }
    })
    setAdjust(null)
  }
  function start(id: string) { const at = Date.now(); const room=store.rooms.find(r=>roomKey(r)===id);if(!room)return; setStore(s => ({ ...s, rooms: s.rooms.map(r => roomKey(r) === id ? { ...r, started: at, ends: at + 3600000 } : r), sessions: [{ id: crypto.randomUUID(), room: room.id, roomUid:id, started: at, ended: null }, ...s.sessions], logs: [record(id, '방 시작 · 60분'), ...s.logs] })) }
  function saveCheckout() {
    if (!checkout || !payMethod) { alert('결제 수단을 선택해 주세요.'); return }
    if (!/^\d+$/.test(payAmount.trim()) || !Number.isSafeInteger(Number(payAmount)) || Number(payAmount) <= 0) { alert('결제금액을 1원 이상의 숫자로 입력해 주세요.'); return }
    const r = store.rooms.find(x => roomKey(x) === checkout)
    if (!r || !r.started) { alert('진행 중인 방이 아닙니다.'); return }
    const at = Date.now(), amount = Number(payAmount)
    const payment: Payment = { id: crypto.randomUUID(), room: r.id, roomUid:checkout, at, amount, method: payMethod, sessionId: store.sessions.filter(x => sameRoom(x,checkout) && x.ended === null).sort((a,b) => b.started-a.started)[0]?.id ?? null, manager: payManager.trim(), memo: payMemo.trim(), wari: payWari.trim(), wt: payWt.trim(), groupId: r.groupId, shopId: groups.find(g => g.id === r.groupId)?.shopId }
    setStore(v => ({ ...v, payments: [payment, ...(v.payments ?? [])], sessions: v.sessions.map(x => sameRoom(x,checkout) && x.ended === null ? { ...x, ended: at } : x), visits: v.visits.map(x => sameRoom(x,checkout) && x.exited === null ? { ...x, exited: at } : x), rooms: v.rooms.map(x => roomKey(x) === checkout ? { ...x, started: null, ends: null, tags: [] } : x), logs: [record(checkout, `마무리(결제) · ${payMethod} · ${amount.toLocaleString('ko-KR')}원`), ...r.tags.map(tag => record(checkout, `${helperName(tag)} 퇴실 · 결제 완료`)), ...v.logs] }))
    setCheckout(null); setDetail(null); setPayMethod(null); setPayAmount(''); setPayManager(''); setPayMemo('')
  }
  function placeMany(ids:string[],destination:string|null){
    const valid=[...new Set(ids)].filter(id=>attendance.some(h=>h.id===id&&h.working))
    if(!valid.length)return
    const at=Date.now()
    setStore(s=>{
      const target=s.rooms.find(r=>roomKey(r)===destination)
      if(destination&&!target)return s
      const moves=valid.filter(id=>!s.rooms.some(r=>roomKey(r)===destination&&r.tags.includes(id)))
      if(!moves.length)return s
      const logs:Log[]=[]
      for(const r of s.rooms)for(const tag of r.tags.filter(t=>moves.includes(t)))logs.push({id:crypto.randomUUID(),at,room:r.id,roomUid:roomKey(r),action:helperName(tag)+' 퇴실'})
      if(target)for(const tag of moves)logs.push({id:crypto.randomUUID(),at,room:target.id,roomUid:roomKey(target),action:helperName(tag)+' 입실'})
      const autoStart=Boolean(target&&!target.started)
      if(autoStart&&target)logs.unshift({id:crypto.randomUUID(),at,room:target.id,roomUid:roomKey(target),action:'첫 입실 · 60분 자동 시작'})
      return {...s,rooms:s.rooms.map(r=>({...r,tags:[...r.tags.filter(t=>!moves.includes(t)),...(roomKey(r)===destination?moves:[])],...(autoStart&&roomKey(r)===destination?{started:at,ends:at+3600000}:{})})),visits:[...(target?moves.map(tag=>({id:crypto.randomUUID(),tag,room:target.id,roomUid:roomKey(target),entered:at,exited:null})):[]),...s.visits.map(v=>moves.includes(v.tag)&&v.exited===null?{...v,exited:at}:v)],logs:[...logs,...s.logs],sessions:autoStart&&target?[{id:crypto.randomUUID(),room:target.id,roomUid:roomKey(target),started:at,ended:null},...s.sessions]:s.sessions}
    })
    setChosen([])
  }
  function place(tag:string,destination:string|null){placeMany([tag],destination)}
  function toggleAttendance(id:string){
    const h=attendance.find(x=>x.id===id);if(!h)return
    if(h.working&&store.rooms.some(r=>r.tags.includes(id))){
      if(!confirm(h.name+' 님이 방에 배치되어 있습니다. 퇴실 후 퇴근 처리할까요?'))return
      placeMany([id],null)
    }
    setStore(s=>({...s,attendance:(s.attendance??[]).map(x=>x.id===id?{...x,working:!x.working}:x)}))
    setChosen(v=>v.filter(x=>x!==id))
  }
  function renameAttendance(id:string){
    const h=attendance.find(x=>x.id===id);if(!h)return
    let name=prompt('출근부 이름 수정',h.name)?.trim()
    while(name){
      if(attendance.some(x=>x.id!==id&&x.name.toLocaleLowerCase()===name!.toLocaleLowerCase())){alert('이미 등록된 이름입니다.');name=prompt('다른 이름 입력',name)?.trim();continue}
      setStore(s=>({...s,attendance:(s.attendance??[]).map(x=>x.id===id?{...x,name}:x)}));return
    }
  }
  function roomTap(id: string) {
    if (held.current) { held.current = false; return }
    if (editing) return
    if (chosen.length) { placeMany(chosen, id); return }
    const t = Date.now()
    if (tap.current?.room === id && t - tap.current.time < 350) { tap.current = null; changeTime(id, 60) }
    else { tap.current = { room: id, time: t }; setTimeout(() => { if (tap.current?.room === id && tap.current.time === t) { tap.current = null; setDetail(id) } }, 360) }
  }
  const selected = store.rooms.find(r => roomKey(r) === detail)
  if(authLoading)return <div className="cloud-gate"><h1>ROOM LIVE</h1><p>로그인 상태 확인 중...</p></div>
  if(!account)return <div className="cloud-gate"><h1>ROOM LIVE</h1><p>Firebase 관리자 로그인</p><form onSubmit={login}><label>이메일<input type="email" autoComplete="username" required value={loginEmail} onChange={e=>setLoginEmail(e.target.value)}/></label><label>비밀번호<input type="password" autoComplete="current-password" required value={loginPassword} onChange={e=>setLoginPassword(e.target.value)}/></label><button disabled={loginBusy} type="submit">{loginBusy?'로그인 중...':'로그인'}</button></form>{remoteError&&<p role="alert" className="cloud-error">{remoteError}</p>}</div>
  if(role==='observer')return <div className="cloud-gate"><h1>ROOM LIVE</h1><p>현황 옵저버 전용 서버 조회 경로를 준비 중입니다. 현재는 민감한 결제 데이터 보호를 위해 접근을 제한합니다.</p><button onClick={()=>signOut(auth)}>로그아웃</button></div>
  if(role==='pending')return <div className="cloud-gate"><h1>ROOM LIVE</h1><p>승인 대기 중인 계정입니다. 관리자에게 Firebase 사용자 UID를 전달하고 승인을 요청해 주세요.</p><p className="hint">내 UID: {account.uid}</p><button onClick={()=>navigator.clipboard?.writeText(account.uid)}>UID 복사</button><button onClick={()=>signOut(auth)}>로그아웃</button></div>
  if(remoteState!=='ready')return <div className="cloud-gate"><h1>ROOM LIVE</h1><p>{remoteState==='empty'?'서버 데이터가 아직 없습니다.':remoteState==='error'?'서버 연결에 실패했습니다.':'실시간 서버 데이터 연결 중...'}</p>{remoteState==='empty'&&<><p>최초 한 번만 이 휴대폰의 기존 데이터를 서버에 등록합니다. 다른 휴대폰에서는 이 버튼을 누르지 마세요.</p><button onClick={importLocal}>이 휴대폰 데이터로 서버 시작</button></>}{remoteError&&<p role="alert" className="cloud-error">{remoteError}</p>}<button onClick={()=>signOut(auth)}>로그아웃</button></div>
  return <div className="app">
    <header><div><span className="kicker">ROOM LIVE · v0.5.2</span><h1>룸 라이브</h1><p>방 · 태그 · 시간 통합 관리</p></div><span className="status">● Firebase 실시간</span></header>
    {page === 'rooms' && <main>
      <div className="section"><h2>방 현황 <small>{store.rooms.length}개</small></h2><button onClick={() => { if(!canOperate)return;setEditing(!editing); setMoving(null); setChosen([]) }}>{editing ? '편집 완료' : '배치 편집'}</button></div>
      <div className="shop-tabs"><button className={shopTab==='all'?'active':''} onClick={()=>setShopTab('all')}>전체</button>{shops.map(sh=><button key={sh.id} className={shopTab===sh.id?'active':''} onClick={()=>setShopTab(sh.id)}>{sh.name}</button>)}</div>
      {shops.filter(sh=>shopTab==='all'||sh.id===shopTab).map(sh=><div className="shop-section" key={sh.id}><div className="shop-divider"><span>{sh.name}</span></div>{editing&&<button className="manage-add" onClick={()=>{const name=prompt(sh.name+' 새 묶음 이름')?.trim();if(!name)return;if(groups.some(g=>g.shopId===sh.id&&g.name.toLocaleLowerCase()===name.toLocaleLowerCase())){alert('같은 가게에 이미 있는 묶음 이름입니다.');return}setStore(v=>({...v,groups:[...(v.groups??[]),{id:crypto.randomUUID(),shopId:sh.id,name,layout:[]}]}))}}>+ {sh.name} 묶음 추가</button>}{groups.filter(g=>g.shopId===sh.id).map(g=>{
        const groupRooms=store.rooms.filter(r=>r.groupId===g.id)
        const used=new Set(g.layout.filter((id):id is string=>id!==null))
        const positions=[...g.layout.filter(id=>id===null||groupRooms.some(r=>roomKey(r)===id)),...groupRooms.map(r=>roomKey(r)).filter(id=>!used.has(id))]
        const move=(from:string,to:number)=>{
          setStore(v=>({...v,groups:(v.groups??[]).map(x=>{
            if(x.id!==g.id)return x
            const next=[...positions],i=next.indexOf(from)
            if(i<0)return x
            const other=next[to];next[to]=from;next[i]=other
            return {...x,layout:next}
          })}))
          setMoving(null)
        }
        return <section key={g.id} className="group-section">
          <div className="section"><h3>{shops.find(sh=>sh.id===g.shopId)?.name} · {g.name}</h3><small>{groupRooms.length}개 방</small></div>
          {editing&&<div className="layout-actions"><button onClick={()=>setStore(v=>({...v,groups:(v.groups??[]).map(x=>x.id===g.id?{...x,layout:[...positions,null,null,null]}:x)}))}>+ 빈 줄</button><button onClick={()=>setStore(v=>({...v,groups:(v.groups??[]).map(x=>{if(x.id!==g.id)return x;const a=[...positions];while(a.length>=3&&a.slice(-3).every(id=>id===null))a.splice(-3);return {...x,layout:a}})}))}>끝 빈 줄 정리</button><button onClick={()=>{setNewRoomGroup(g.id);setNewRoomName('');setRoomError('')}}>+ 방 추가</button></div>}
          <div className="room-grid three-cols">{positions.map((id,index)=>{
            const r=groupRooms.find(x=>roomKey(x)===id)
            if(!r)return <button key={'empty'+index} className={'empty-slot '+(editing?'editable':'')} disabled={!editing} onClick={()=>{if(moving)move(moving,index)}}>{editing?'＋ 빈칸':''}</button>
            const expired=Boolean(r.ends&&r.ends<=now)
            return <div key={roomKey(r)} className={'room '+(r.ends?'running ':'')+(expired?'expired ':'')+(moving===roomKey(r)?'moving':'')}
              onClick={()=>editing?(moving?move(moving,index):setMoving(roomKey(r))):roomTap(roomKey(r))}
              onPointerDown={e=>{touchStart.current={x:e.clientX,y:e.clientY};held.current=false;if(!editing&&!chosen.length)hold.current=setTimeout(()=>{held.current=true;setDetail(null);setAdjust(roomKey(r))},550)}}
              onPointerMove={e=>{if(touchStart.current&&Math.hypot(e.clientX-touchStart.current.x,e.clientY-touchStart.current.y)>12&&hold.current)clearTimeout(hold.current)}}
              onPointerUp={()=>{if(hold.current)clearTimeout(hold.current)}} onPointerLeave={()=>{if(hold.current)clearTimeout(hold.current)}} onPointerCancel={()=>{if(hold.current)clearTimeout(hold.current)}}
              onContextMenu={e=>{e.preventDefault();if(!editing&&!chosen.length){held.current=true;setAdjust(roomKey(r))}}}>
              <div className="room-head"><strong>{r.id}</strong><span>{expired?'시간 종료':r.ends?'이용 중':'대기'}</span></div>
              <div className="time">{r.ends?format(r.ends-now):'--:--:--'}</div>
              <div className="tags">{r.tags.length?r.tags.map(helperName).join(' · '):'배치 인원 없음'}</div>
              {editing&&<div className="room-tools"><button onClick={e=>{e.stopPropagation();let name=prompt('방 이름',r.id)?.trim().toUpperCase();while(name&&name!==r.id){if(duplicated(name,g.shopId,roomKey(r))){alert('같은 가게에 이미 등록된 방 이름입니다. 다시 입력해 주세요.');name=prompt('다른 방 이름 입력',name)?.trim().toUpperCase();continue}setStore(v=>({...v,rooms:v.rooms.map(x=>roomKey(x)===roomKey(r)?{...x,id:name}:x),logs:v.logs.map(x=>sameRoom(x,roomKey(r))?{...x,room:name}:x),visits:v.visits.map(x=>sameRoom(x,roomKey(r))?{...x,room:name}:x),sessions:v.sessions.map(x=>sameRoom(x,roomKey(r))?{...x,room:name}:x),payments:v.payments.map(x=>sameRoom(x,roomKey(r))?{...x,room:name}:x)}));break}}}>이름</button><button onClick={e=>{e.stopPropagation();if(r.started||r.tags.length){alert('진행 중인 방은 이동할 수 없습니다.');return}const dest=prompt('이동할 묶음 이름',g.name);const target=groups.find(x=>x.name===dest&&x.id!==g.id);if(target&&duplicated(r.id,target.shopId)){alert('이동할 가게에 같은 이름의 방이 있습니다. 이름을 변경한 후 이동해 주세요.');return}if(target)setStore(v=>({...v,rooms:v.rooms.map(x=>roomKey(x)===roomKey(r)?{...x,groupId:target.id}:x),groups:(v.groups??[]).map(x=>x.id===g.id?{...x,layout:x.layout.map(y=>y===roomKey(r)?null:y)}:x)}))}}>이동</button><button onClick={e=>{e.stopPropagation();if(r.started||r.tags.length){alert('이용 중인 방은 삭제할 수 없습니다.');return}if(confirm(r.id+' 삭제할까요?'))setStore(v=>({...v,rooms:v.rooms.filter(x=>roomKey(x)!==roomKey(r)),groups:(v.groups??[]).map(x=>({...x,layout:x.layout.map(y=>y===roomKey(r)?null:y)}))}))}}>삭제</button></div>}
              {!editing&&chosen.length>0&&<button className="place" onClick={e=>{e.stopPropagation();placeMany(chosen,roomKey(r))}}>+ {chosen.length}명 배치</button>}
              {!editing&&r.started&&<button className={'room-pay '+(expired?'attention':'')} onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();openCheckout(roomKey(r))}}>{expired?'⚠ 결제 필요':'결제'}</button>}
            </div>
          })}</div>
        </section>
      })}</div>)}
      <div className="section"><h2>출근부 · 대기 <small>{waiting.length}명</small></h2><button onClick={()=>setPage('attendance')}>출근부 관리</button></div>
      <p className="hint">대기 인원을 여러 명 선택한 뒤 방을 터치하면 동시에 입실합니다. 빈방은 60분 자동 시작됩니다.</p>
      <div className="tag-list">{waiting.map(h=><button key={h.id} className={chosen.includes(h.id)?'picked':''} onClick={()=>setChosen(v=>v.includes(h.id)?v.filter(x=>x!==h.id):[...v,h.id])}>{h.name}<small>{chosen.includes(h.id)?'✓ 선택됨':'대기'}</small></button>)}</div>
      {chosen.length>0&&<div className="selection-bar"><b>{chosen.length}명 선택됨</b><button onClick={()=>setChosen([])}>선택 해제</button></div>}
      {!waiting.length&&<p className="hint">출근 중인 대기 인원이 없습니다. 출근부에서 출근 처리해 주세요.</p>}
      <p className="hint">방 한 번 터치: 상세 · 두 번 터치: +1시간 · 길게 누르기: 시간 조절</p>
    </main>}
    {page==='logs'&&<main><div className="section"><h2>{historyRoom ? roomName(historyRoom)+' 진행 기록' : '방별 진행 기록'}</h2>{historyRoom&&<button onClick={()=>setHistoryRoom(null)}>← 방 목록</button>}</div>
      {!historyRoom?<div className="history-rooms">{store.rooms.map(r=><button key={roomKey(r)} onClick={()=>{setHistoryRoom(roomKey(r));setDay('')}}><strong>{r.id}</strong><span>{shops.find(sh=>sh.id===shopFor(r))?.name} · {groups.find(g=>g.id===r.groupId)?.name}<small>이용 회차 {store.sessions.filter(x=>sameRoom(x,roomKey(r))).length}건 · 결제 {store.payments.filter(x=>sameRoom(x,roomKey(r))).length}건</small></span><b>›</b></button>)}</div>:<><div className="filters"><input type="date" value={day} onChange={e=>setDay(e.target.value)}/><button onClick={()=>setDay('')}>전체 날짜</button></div>
      <h3>이용 회차</h3><div className="sessions">{store.sessions.filter(x=>sameRoom(x,historyRoom)&&(!day||new Date(x.started).toLocaleDateString('sv-SE')===day)).map(x=><button key={x.id} onClick={()=>setViewSession(x.id)}>{date(x.started)} · {x.ended?'종료':'진행 중'} ›</button>)}</div>
      <h3>결제 내역</h3><div className="logs">{store.payments.filter(x=>sameRoom(x,historyRoom)&&(!day||new Date(x.at).toLocaleDateString('sv-SE')===day)).map(x=><div className="log" key={x.id}><b>{x.method}</b><div><strong>{x.amount.toLocaleString('ko-KR')}원</strong><small>{date(x.at)}</small>{x.manager&&<small>담당: {x.manager}</small>}{x.wari&&<small>와리: {x.wari}</small>}{x.wt&&<small>WT: {x.wt}</small>}{x.memo&&<small>비고: {x.memo}</small>}</div></div>)}</div>
      <h3>활동 로그</h3><div className="logs">{store.logs.filter(x=>sameRoom(x,historyRoom)&&(!day||new Date(x.at).toLocaleDateString('sv-SE')===day)).map(x=><div className="log" key={x.id}><b>{x.room}</b><div><strong>{x.action}</strong><small>{date(x.at)}</small></div></div>)}</div></>}
    </main>}
    {page==='attendance'&&<main><div className="section"><h2>출근부 <small>출근 {attendance.filter(h=>h.working).length}명 / 전체 {attendance.length}명</small></h2><button onClick={()=>{let name=prompt('새 이름 등록')?.trim();while(name){if(attendance.some(h=>h.name.toLocaleLowerCase()===name!.toLocaleLowerCase())){alert('이미 등록된 이름입니다.');name=prompt('다른 이름 입력',name)?.trim();continue}setStore(v=>({...v,attendance:[...(v.attendance??[]),{id:crypto.randomUUID(),name,working:false}]}));break}}}>+ 이름 추가</button></div><p className="hint">이름을 누르면 출근, 다시 누르면 퇴근합니다. 출근한 인원은 방 현황 대기 목록에 자동 표시됩니다.</p><div className="attendance-list">{attendance.map(h=><div key={h.id} className={h.working?"attendance-item working":"attendance-item"}><button className="attendance-toggle" onClick={()=>toggleAttendance(h.id)}><strong>{h.name}</strong><span>{h.working?'● 출근 중':'○ 퇴근'}</span></button><button className="attendance-edit" onClick={()=>renameAttendance(h.id)}>이름 수정</button></div>)}</div></main>}
    {page==='payments'&&isAdmin&&<main><h2>결제 현황</h2><div className="shop-tabs"><button className={payShopTab==='all'?'active':''} onClick={()=>{setPayShopTab('all');setPayGroup('all')}}>전체</button>{shops.map(sh=><button key={sh.id} className={payShopTab===sh.id?'active':''} onClick={()=>{setPayShopTab(sh.id);setPayGroup('all')}}>{sh.name}</button>)}</div><div className="filters"><input type="date" value={payDay} onChange={e=>setPayDay(e.target.value)}/><button onClick={()=>setPayDay('')}>전체 날짜</button><select value={payGroup} onChange={e=>setPayGroup(e.target.value)}><option value="all">전체 묶음</option>{groups.filter(g=>payShopTab==='all'||g.shopId===payShopTab).map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
      {(()=>{const items=(store.payments??[]).filter(p=>(payShopTab==='all'||p.shopId===payShopTab)&&(payGroup==='all'||p.groupId===payGroup)&&(!payDay||new Date(p.at).toLocaleDateString('sv-SE')===payDay));const paid=items.filter(p=>p.method!=='미수').reduce((n,p)=>n+p.amount,0),due=items.filter(p=>p.method==='미수').reduce((n,p)=>n+p.amount,0);return <><div className="payment-summary"><div><small>수금 합계</small><strong>{paid.toLocaleString('ko-KR')}원</strong></div><div><small>미수 합계</small><strong>{due.toLocaleString('ko-KR')}원</strong></div></div><h3>묶음별 결제</h3>{groups.filter(g=>payShopTab==='all'||g.shopId===payShopTab).filter(g=>payGroup==='all'||g.id===payGroup).map(g=>{const rows=items.filter(p=>p.groupId===g.id);return <button className="group-payment" key={g.id} onClick={()=>setPayGroup(g.id)}><b>{shops.find(x=>x.id===g.shopId)?.name} · {g.name}</b><span>수금 {rows.filter(p=>p.method!=='미수').reduce((n,p)=>n+p.amount,0).toLocaleString('ko-KR')}원</span><span>미수 {rows.filter(p=>p.method==='미수').reduce((n,p)=>n+p.amount,0).toLocaleString('ko-KR')}원</span></button>})}<div className="section"><h3>결제 내역 · 특이사항</h3><label className="memo-filter"><input type="checkbox" checked={memoOnly} onChange={e=>setMemoOnly(e.target.checked)}/> 비고만</label></div>{items.filter(p=>!memoOnly||Boolean(p.memo?.trim())).map(p=><div className="payment-entry" key={p.id}><strong>{p.room} · {p.method} · {p.amount.toLocaleString('ko-KR')}원</strong><small>{shops.find(x=>x.id===p.shopId)?.name} / {groups.find(g=>g.id===p.groupId)?.name} · {date(p.at)}</small>{p.manager&&<small>담당: {p.manager}</small>}{p.wari&&<small>와리: {p.wari}</small>}{p.wt&&<small>WT: {p.wt}</small>}{p.memo&&<p>비고: {p.memo}</p>}</div>)}{items.length===0&&<p className="hint">해당 기간의 결제 기록이 없습니다.</p>}</>})()}</main>}
    {page==='settings'&&isAdmin&&<main><h2>설정</h2><div className="section"><span>서버 연결: Firebase 실시간 동기화 · {role==='admin'?'관리자':'직원'}</span><button onClick={()=>signOut(auth)}>로그아웃</button></div><h3>직원 접근 승인</h3><p className="hint">Firebase Authentication에서 직원 계정을 만든 뒤 UID를 등록하세요. 직원은 승인 후 같은 데이터를 실시간으로 공유합니다.</p><button className="manage-add" onClick={addStaff}>+ 직원 UID 승인</button>{Object.entries(approvedStaff).map(([uid,v])=><div className="manage-row" key={uid}><small>{uid} · {v==='staff'||v==='worker'?'실무자':v==='observer'?'현황 옵저버':'관리자'}</small><button onClick={()=>changeStaffRole(uid)}>권한 변경</button><button onClick={()=>revokeStaff(uid)}>승인 해제</button></div>)}<h3>결제 입력 항목</h3><label className="setting-row"><span>와리 표시</span><input type="checkbox" checked={store.showWari!==false} onChange={e=>setStore(v=>({...v,showWari:e.target.checked}))}/></label><label className="setting-row"><span>WT 표시</span><input type="checkbox" checked={store.showWt!==false} onChange={e=>setStore(v=>({...v,showWt:e.target.checked}))}/></label><h3>가게 관리</h3>{shops.map(sh=><div className="manage-row" key={sh.id}><b>{sh.name}</b><button onClick={()=>renameShop(sh.id)}>이름 변경</button></div>)}<button className="manage-add" onClick={()=>{const name=prompt('추가할 가게 이름')?.trim();if(name){if(shops.some(x=>x.name.toLocaleLowerCase()===name.toLocaleLowerCase())){alert('이미 등록된 가게 이름입니다.');return}setStore(v=>({...v,shops:[...(v.shops??[]),{id:crypto.randomUUID(),name}]}))}}}>+ 가게 추가</button><h3>방 묶음 관리</h3>{groups.map(g=><div className="manage-row" key={g.id}><div><b>{g.name}</b><small>{shops.find(sh=>sh.id===g.shopId)?.name}</small></div><button onClick={()=>{const name=prompt('묶음 이름',g.name)?.trim();if(name)setStore(v=>({...v,groups:(v.groups??[]).map(x=>x.id===g.id?{...x,name}:x)}))}}>이름</button><button onClick={()=>{if(store.rooms.some(r=>r.groupId===g.id)){alert('방이 있는 묶음은 삭제할 수 없습니다.');return}if(confirm(g.name+' 삭제할까요?'))setStore(v=>({...v,groups:(v.groups??[]).filter(x=>x.id!==g.id)}))}}>삭제</button></div>)}<button className="manage-add" onClick={()=>{const name=prompt('새 묶음 이름')?.trim();if(!name)return;const sh=prompt('소속 가게 이름',shops[0]?.name);const target=shops.find(x=>x.name===sh);if(!target){alert('등록된 가게 이름을 입력해 주세요.');return}setStore(v=>({...v,groups:[...(v.groups??[]),{id:crypto.randomUUID(),shopId:target.id,name,layout:[]}]}))}}>+ 묶음 추가</button><p className="hint">Firebase 실시간 공유 사용 중 · 직원은 방 현황, 출근부, 기록, 결제 기능을 사용합니다.</p><button className="danger" onClick={()=>{if(confirm('모든 테스트 기록을 삭제할까요?'))setStore(seed)}}>테스트 기록 초기화</button></main>}
    {remoteError&&<div className="cloud-error" role="alert" onClick={()=>setRemoteError('')}>{remoteError} · 눌러 닫기</div>}
    <nav className="nav-five"><button className={page === 'rooms' ? 'on' : ''} onClick={() => setPage('rooms')}>▦<span>방 현황</span></button><button className={page === 'attendance' ? 'on' : ''} onClick={() => setPage('attendance')}>♙<span>출근부</span></button><button className={page === 'logs' ? 'on' : ''} onClick={() => setPage('logs')}>◷<span>진행 기록</span></button>{isAdmin&&<button className={page === 'payments' ? 'on' : ''} onClick={() => setPage('payments')}>₩<span>결제·매출</span></button>}{isAdmin&&<button className={page === 'settings' ? 'on' : ''} onClick={() => setPage('settings')}>⚙<span>설정</span></button>}{!isAdmin&&<button onClick={()=>signOut(auth)}>⇥<span>로그아웃</span></button>}</nav>
    {newRoomGroup&&<div className="overlay" onClick={()=>setNewRoomGroup(null)}><section className="modal" onClick={e=>e.stopPropagation()}><h2>방 추가</h2><p className="hint">{shops.find(sh=>sh.id===groups.find(g=>g.id===newRoomGroup)?.shopId)?.name} · {groups.find(g=>g.id===newRoomGroup)?.name}</p><label className="amount-label">방 이름<input autoFocus value={newRoomName} onChange={e=>{setNewRoomName(e.target.value.toUpperCase());setRoomError('')}} placeholder="예: 1T" maxLength={40}/></label>{roomError&&<p className="form-error">{roomError}</p>}<div className="buttons"><button onClick={()=>setNewRoomGroup(null)}>취소</button><button onClick={()=>{const name=newRoomName.trim().toUpperCase();const g=groups.find(x=>x.id===newRoomGroup);if(!name||!g){setRoomError('방 이름을 입력해 주세요.');return}if(duplicated(name,g.shopId)){setRoomError('같은 가게에 이미 등록된 방 이름입니다. 다른 이름을 입력해 주세요.');return}setStore(v=>({...v,rooms:[...v.rooms,{uid:crypto.randomUUID(),id:name,groupId:g.id,started:null,ends:null,tags:[]}]}));setNewRoomGroup(null);setNewRoomName('');setRoomError('')}}>방 추가 완료</button></div></section></div>}
    {selected && <div className="overlay" onClick={() => setDetail(null)}><section className="modal" onClick={e => e.stopPropagation()}><div className="section"><h2>{selected.id} 상세</h2><button onClick={() => setDetail(null)}>닫기</button></div><div className="large-time">{selected.ends ? format(selected.ends - now) : '대기 중'}</div><p className="hint">{selected.started ? `시작: ${date(selected.started)}` : '시작 전'}</p><div className="buttons"><button onClick={() => selected.ends ? changeTime(roomKey(selected), 60) : start(roomKey(selected))}>{selected.ends ? '+1시간' : '60분 시작'}</button><button onClick={() => { setAdjust(roomKey(selected)); setDetail(null) }}>시간 조절</button>{selected.started && <button className="checkout-open" onClick={() => { openCheckout(roomKey(selected)) }}>마무리 (결제)</button>}</div><h3>배치된 인원</h3>{selected.tags.map(tag => <div className="tag-row" key={tag}><span>{helperName(tag)}<small>{(() => { const v = store.visits.find(x => x.tag === tag && x.exited === null && sameRoom(x,roomKey(selected))); return v ? ` · 입실 ${date(v.entered)} · ${Math.floor((now - v.entered)/60000)}분 경과` : '' })()}</small></span><button onClick={() => place(tag, null)}>퇴실</button></div>)}{!selected.tags.length && <p className="hint">태그 없음</p>}</section></div>}
    {checkout && <div className="overlay" onClick={() => setCheckout(null)}><section className="modal" onClick={e => e.stopPropagation()}><div className="section"><h2>{roomName(checkout)} · 마무리(결제)</h2><button onClick={() => setCheckout(null)}>취소</button></div><p className="hint">결제 수단을 선택하고 금액을 입력한 후 완료하세요. 미수는 실제 수금이 아닌 미수 기록으로 저장됩니다.</p><div className="pay-methods">{(['카드','현금','이체','미수'] as const).map(m => <button key={m} className={payMethod === m ? 'active' : ''} onClick={() => setPayMethod(m)}>{m}</button>)}</div><label className="amount-label">{payMethod === '미수' ? '미수 금액' : '결제금액'} (원)<input inputMode="numeric" type="text" pattern="[0-9]*" placeholder="예: 150000" value={payAmount} onChange={e => setPayAmount(e.target.value.replace(/[^0-9]/g,''))}/></label><label className="amount-label checkout-extra">담당<input type="text" maxLength={80} placeholder="담당자 이름 입력" value={payManager} onChange={e => setPayManager(e.target.value)}/></label>{store.showWari!==false&&<label className="amount-label checkout-extra">와리<input type="text" value={payWari} onChange={e=>setPayWari(e.target.value)} placeholder="와리 입력"/></label>}{store.showWt!==false&&<label className="amount-label checkout-extra">WT<input type="text" value={payWt} onChange={e=>setPayWt(e.target.value)} placeholder="WT 입력"/></label>}<label className="amount-label checkout-extra">비고 (메모)<textarea rows={3} maxLength={1000} placeholder="결제 관련 메모 입력" value={payMemo} onChange={e => setPayMemo(e.target.value)}/></label><button className="pay-submit" disabled={!payMethod || !payAmount || Number(payAmount) <= 0} onClick={saveCheckout}>완료 · 기록 저장 및 방 마무리</button></section></div>}
    {adjust && <div className="overlay" onClick={() => setAdjust(null)}><section className="modal" onClick={e => e.stopPropagation()}><div className="section"><h2>{roomName(adjust)} 시간 조절</h2><button onClick={() => setAdjust(null)}>닫기</button></div><p className="hint">시간 추가</p><div className="adjust">{[1, 5, 10, 30, 60].map(m => <button className="plus" key={m} onClick={() => changeTime(adjust, m)}>+{m === 60 ? '1시간' : m + '분'}</button>)}</div><p className="hint">시간 차감</p><div className="adjust">{[1, 5, 10, 30, 60].map(m => <button className="minus" key={m} onClick={() => changeTime(adjust, -m)}>-{m === 60 ? '1시간' : m + '분'}</button>)}</div></section></div>}
    {viewSession && <div className="overlay" onClick={() => setViewSession(null)}><section className="modal" onClick={e => e.stopPropagation()}><div className="section"><h2>이용 회차 상세</h2><button onClick={() => setViewSession(null)}>닫기</button></div>{(() => { const x = store.sessions.find(s => s.id === viewSession); if (!x) return null; const next = store.sessions.filter(s => (x.roomUid ? s.roomUid === x.roomUid : s.room === x.room) && s.started > x.started).sort((a,b) => a.started-b.started)[0]; const end = x.ended ?? next?.started ?? now; return <><p>{x.room} · 시작 {date(x.started)}</p><p>종료 {x.ended ? date(x.ended) : '진행 중'} · 경과 {Math.floor((end-x.started)/60000)}분</p><h3>태그 입퇴실</h3>{store.visits.filter(v => (x.roomUid ? v.roomUid === x.roomUid : v.room === x.room) && v.entered >= x.started && v.entered <= end).map(v => <p className="visit" key={v.id}>{helperName(v.tag)} · 입실 {date(v.entered)} · 퇴실 {v.exited ? date(v.exited) : '이용 중'}</p>)}<h3>조작 기록</h3>{store.logs.filter(l => (x.roomUid ? l.roomUid === x.roomUid : l.room === x.room) && l.at >= x.started && l.at <= end).map(l => <p className="visit" key={l.id}>{date(l.at)} · {l.action}</p>)}</> })()}</section></div>}
  </div>
}
