import { useEffect, useRef, useState } from 'react'
import './App.css'
import type { FormEvent, MouseEvent } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { onValue, runTransaction, ref, set, remove } from 'firebase/database'
import { auth, database, roomLiveRef, ADMIN_UID } from './firebase'
import { loginEmailFromInput, staffEmailFromId } from './staff-login'

import { seed, read, normalizeRemote, format, operatingDay, ledgerDay, kstDate, date } from './store-model'
import { workerViewOf } from './worker-view'
import { applyCheckout } from './services/checkout'
import { applyCancelRoom } from './services/cancel-room'
import { dailyShiftSummary,shiftDays,shiftDate,timeLength } from './attendance-summary'
import { OPERATIONS_PATH, FINANCE_PATH, CHECKOUT_PATH, toOperations, mergeSplit } from './services/split-store'
import type { ObserverRoom, ObserverSnapshot, Room, Log, Payment, Store } from './store-model'

export default function App() {
  const [store, setStoreState] = useState<Store>(read)
  const [account, setAccount] = useState<User|null>(null)
  const [role,setRole]=useState<'admin'|'worker'|'observer'|'pending'>('pending')
  const [approvedStaff,setApprovedStaff]=useState<Record<string,string>>({})
  const [staffProfiles,setStaffProfiles]=useState<Record<string,{name:string;loginId:string}>>({})
  const [signupMode,setSignupMode]=useState(false)
  const [signupName,setSignupName]=useState('')
  const [signupBusy,setSignupBusy]=useState(false)
  const [observerData,setObserverData]=useState<ObserverSnapshot|null>(null)
  const isAdmin=account?.uid===ADMIN_UID && account?.email?.toLowerCase()==='zkxkvl@gmail.com'
  const canOperate=role==='admin'||role==='worker'
  const [authLoading, setAuthLoading] = useState(true)
  const [remoteState, setRemoteState] = useState<'loading'|'empty'|'ready'|'error'>('loading')
  const [remoteError, setRemoteError] = useState('')
  const [uiDialog,setUiDialog]=useState<{title:string;message?:string;kind:'confirm'|'input';value:string;danger?:boolean;onAccept:(value:string)=>void}|null>(null)
  function askConfirm(title:string,message:string,onAccept:()=>void,danger=true){
    setUiDialog({title,message,kind:'confirm',value:'',danger,onAccept})
  }
  function askInput(title:string,value:string,onAccept:(value:string)=>void){
    setUiDialog({title,kind:'input',value,onAccept})
  }
  function acceptDialog(){
    if(!uiDialog)return
    const action=uiDialog.onAccept,value=uiDialog.value
    setUiDialog(null)
    action(value)
  }
  const [notice,setNotice]=useState('')
  const [ledgerEdit,setLedgerEdit]=useState<{id:string;amount:string;method:Payment['method'];note:string}|null>(null)
  const [groupDraft,setGroupDraft]=useState<{name:string;shopId:string}|null>(null)
  function notify(message:string){setNotice(message)}
  const [systemWarning,setSystemWarning]=useState('')
  const [showSystemDetails,setShowSystemDetails]=useState(false)
  const [loginId, setLoginId] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)
  const localInitial = useRef<Store>(read())
  const readyRef = useRef(false)
  const transactionQueue = useRef<Promise<unknown>>(Promise.resolve())
  const checkoutPendingRef=useRef(false)
  const [checkoutSaving,setCheckoutSaving]=useState(false)
  const [v2Active,setV2Active]=useState(false)
  const v2OperationsRef=useRef<Store|null>(null)
  const v2PaymentsRef=useRef<Payment[]>([])
  function setStore(update:Store|((previous:Store)=>Store)) {
    if(!canOperate){notify('현황 옵저버는 조회만 가능합니다.');return}
    if(!readyRef.current){notify('서버 데이터 연결이 완료된 후 수정할 수 있습니다.');return}
    const requestedBy=auth.currentUser?.uid
    const operation=async()=>{
      if(!requestedBy||auth.currentUser?.uid!==requestedBy||!readyRef.current)return
      try {
        const target=v2Active?ref(database,OPERATIONS_PATH):roomLiveRef
        const result=await runTransaction(target,current=>{
          if(current===null)return
          const previous=normalizeRemote(v2Active?{...current,payments:v2PaymentsRef.current} as Store:current as Store)
          const next=typeof update==='function'?update(previous):update
          return v2Active?toOperations(next):next
        },{applyLocally:false})
        if(!result.committed)throw Error('서버에 저장되지 않았습니다.')
      }catch(error){setRemoteError('저장 실패: '+(error instanceof Error?error.message:String(error)))}
    }
    transactionQueue.current=transactionQueue.current.then(operation,operation)
  }
  function setLedger(update:(previous:Store)=>Store){
    if(!isAdmin||!readyRef.current)return
    if(!v2Active){setStore(update);return}
    const requestedBy=auth.currentUser?.uid
    const operation=async()=>{
      if(!requestedBy||auth.currentUser?.uid!==requestedBy)return
      try{
        const result=await runTransaction(ref(database,FINANCE_PATH),current=>{
          if(!current)return
          const previous=normalizeRemote({...v2OperationsRef.current,payments:current.payments??[]} as Store)
          const next=update(previous)
          return {...current,payments:next.payments}
        },{applyLocally:false})
        if(!result.committed)throw Error('장부 수정이 저장되지 않았습니다.')
      }catch(error){setRemoteError('장부 수정 실패: '+String(error))}
    }
    transactionQueue.current=transactionQueue.current.then(operation,operation)
  }
  const [now, setNow] = useState(Date.now())
  const [page, setPage] = useState<'rooms' | 'attendance' | 'logs' | 'payments' | 'settings'>('rooms')
  const [detail, setDetail] = useState<string | null>(null)
  const [adjust, setAdjust] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const [headcountMenu,setHeadcountMenu]=useState<{id:string;top:number;left:number;width:number}|null>(null)
  const [outBusy,setOutBusy]=useState(false)
  const [editing, setEditing] = useState(false)
  const [moving, setMoving] = useState<string | null>(null)
  const [directMinutes,setDirectMinutes]=useState('')
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
  const [attendanceTab,setAttendanceTab]=useState('all')
  const [attendanceOrder,setAttendanceOrder]=useState<'name'|'office'>('name')
  const [attendanceTeamEditing,setAttendanceTeamEditing]=useState(false)
  const [attendanceTeamSaving,setAttendanceTeamSaving]=useState<Record<string,boolean>>({})
  const [attendanceAddOpen,setAttendanceAddOpen]=useState(false)
  const [attendanceNewName,setAttendanceNewName]=useState('')
  const [attendanceNewTeam,setAttendanceNewTeam]=useState('')
  const [attendanceAddError,setAttendanceAddError]=useState('')
  const [attendanceTc,setAttendanceTc]=useState<string|null>(null)
  const [attendanceDeleteId,setAttendanceDeleteId]=useState<string|null>(null)
  const [attendanceDeleting,setAttendanceDeleting]=useState(false)
  const [attendanceTcDate,setAttendanceTcDate]=useState('')
  const [payShopTab, setPayShopTab] = useState('all')
  const [payGroup, setPayGroup] = useState('all')
  const [payDay, setPayDay] = useState('')
  const [ledgerPeriod,setLedgerPeriod]=useState<'day'|'month'>('day')
  const [ledgerMethod,setLedgerMethod]=useState<'전체'|Payment['method']>('전체')
  const [memoOnly, setMemoOnly] = useState(false)
  const [collectId,setCollectId]=useState<string|null>(null)
  const [collectMethod,setCollectMethod]=useState<'현금'|'카드'|'이체'|null>(null)
  const [collectNote,setCollectNote]=useState('')
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
      setRole(user?.uid===ADMIN_UID && user.email?.toLowerCase()==='zkxkvl@gmail.com'?'admin':'pending')
      setAuthLoading(false)
      setRemoteState('loading')
    })
  },[])
  useEffect(()=>{
    if(!account||role==='pending'||role==='observer'){setV2Active(false);return}
    return onValue(ref(database,'roomLiveV2/config/active'),snapshot=>setV2Active(snapshot.val()===true),
      error=>setRemoteError('V2 설정 확인 실패: '+error.message))
  },[account,role])
  useEffect(()=>{if((!isAdmin&&page==='settings')||(role==='observer'&&page!=='rooms'))setPage('rooms')},[isAdmin,page,role])
  useEffect(()=>{
    if(!account||role!=='observer')return
    setRemoteState('loading')
    const unsubscribe=onValue(ref(database,'roomLiveObserver'),snapshot=>{
      const value=snapshot.val() as ObserverSnapshot|null
      setObserverData(value)
      setRemoteState(value?'ready':'empty')
    },error=>{setRemoteState('error');setRemoteError('옵저버 현황 조회 실패: '+error.message)})
    return unsubscribe
  },[account,role])
  useEffect(()=>{
    if(!isAdmin||v2Active||remoteState!=='ready')return
    const rooms:ObserverRoom[]=store.rooms.map(r=>{
      const group=(store.groups??[]).find(g=>g.id===r.groupId)
      return {uid:r.uid??r.id,name:r.id,shop:(store.shops??[]).find(sh=>sh.id===group?.shopId)?.name??'',group:group?.name??'',started:r.started??null,ends:r.ends??null,headcount:r.tags.length}
    })
    // A separate, deliberately minimal read-only projection: no names, payments or logs.
    void set(ref(database,'roomLiveObserver'),{rooms,updatedAt:Date.now()}).catch(error=>setRemoteError('현황 공유 갱신 실패: '+String(error)))
  },[isAdmin,store,remoteState,v2Active])
  useEffect(()=>{
    if(!isAdmin||v2Active||remoteState!=='ready'||!readyRef.current)return
    // Publish a strictly allowlisted view whenever the admin receives an updated store.
    // This is a projection, not a source of truth or a security cutover.
    const view=workerViewOf(store)
    void set(ref(database,'roomLiveV2/workerView'),view).catch(error=>
      setRemoteError('실무자 조회 데이터 동기화 실패: '+String(error)))
  },[isAdmin,store,remoteState,v2Active])
  useEffect(()=>{
    if(!isAdmin||v2Active||remoteState!=='ready'||!readyRef.current)return
    // Stage finance from the same authoritative stream used by the administrator.
    // Do not promote V2 to the live ledger here: workers still write to roomLive.
    const financeRef=ref(database,'roomLiveV2/finance')
    const finance={payments:store.payments,sessions:store.sessions}
    void runTransaction(financeRef,current=>{
      if(current===null)return
      // Never overwrite a newer snapshot with an older event arriving out of order.
      const currentPayments=Array.isArray(current.payments)?current.payments:Object.values(current.payments??{})
      const existingIds=new Set((currentPayments as Payment[]).map(p=>p.id))
      const incomingIds=new Set(finance.payments.map(p=>p.id))
      if([...existingIds].some(id=>!incomingIds.has(id)))return
      // Protect newer corrections already staged by a later admin update.
      const incomingById=new Map(finance.payments.map(p=>[p.id,p]))
      if((currentPayments as Payment[]).some(old=>{
        const incoming=incomingById.get(old.id)
        return incoming&&((old.correctedAt??0)>(incoming.correctedAt??0))
      }))return
      return finance
    },{applyLocally:false}).then(result=>{
      if(!result.committed)setSystemWarning('V2 장부 갱신 보류: 기존 V2 결제에 원본에 없는 ID가 있습니다. 관리자 대조 필요')
    }).catch(error=>setSystemWarning('V2 장부 동기화 실패: '+String(error)))
  },[isAdmin,store,remoteState,v2Active])
  useEffect(()=>{
    if(!account||role==='pending'||role==='observer')return
    setRemoteError('')
    readyRef.current=false
    setRemoteState('loading')
    if(v2Active){
      // Preserve local backups during migration; never erase them on a feature-flag change.
      v2OperationsRef.current=null
      v2PaymentsRef.current=[]
      let financeLoaded=!isAdmin
      const refresh=()=>{
        if(!v2OperationsRef.current||!financeLoaded)return
        const data=mergeSplit(v2OperationsRef.current,isAdmin?{payments:v2PaymentsRef.current}:null)
        if(!data)return
        readyRef.current=true
        setStoreState(normalizeRemote(data))
        setRemoteState('ready')
      }
      const unsubOps=onValue(ref(database,OPERATIONS_PATH),snapshot=>{
        const raw=snapshot.val()
        v2OperationsRef.current=raw?normalizeRemote({...raw,payments:[]} as Store):null
        if(!raw){readyRef.current=false;setRemoteState('empty')}
        else refresh()
      },error=>{readyRef.current=false;setRemoteState('error');setRemoteError('운영 데이터 조회 실패: '+error.message)})
      const unsubFinance=isAdmin?onValue(ref(database,FINANCE_PATH),snapshot=>{
        const value=snapshot.val()
        v2PaymentsRef.current=(Array.isArray(value?.payments)?value.payments:Object.values(value?.payments??{})) as Payment[]
        financeLoaded=true
        refresh()
      },error=>{readyRef.current=false;setRemoteState('error');setRemoteError('장부 조회 실패: '+error.message)}):()=>{}
      return ()=>{readyRef.current=false;unsubOps();unsubFinance()}
    }
    const unsubscribe=onValue(roomLiveRef,snapshot=>{
      const raw=snapshot.val() as Store|null
      const data=raw?normalizeRemote(raw):null
      readyRef.current=Boolean(data)
      if(data){
        if(!localStorage.getItem('room-live-precloud-backup-v1')){
          const previous=localStorage.getItem('room-live-v1')
          if(previous)localStorage.setItem('room-live-precloud-backup-v1',previous)
        }
        setStoreState(data);setRemoteState('ready')
        if(isAdmin)localStorage.setItem('room-live-v1',JSON.stringify(data))
      }else setRemoteState('empty')
    },error=>{readyRef.current=false;setRemoteState('error');setRemoteError(error.message)})
    return ()=>{readyRef.current=false;unsubscribe()}
  },[account,role,v2Active,isAdmin])
  useEffect(()=>{
    if(!account||isAdmin)return
    const unsub=onValue(ref(database,'roomLiveAccess/'+account.uid),snapshot=>{
      setRole(snapshot.val()==='worker'||snapshot.val()==='staff'?'worker':snapshot.val()==='observer'?'observer':'pending')
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
  useEffect(()=>{
    if(!isAdmin)return
    return onValue(ref(database,'roomLiveProfiles'),snapshot=>setStaffProfiles((snapshot.val()??{}) as Record<string,{name:string;loginId:string}>),error=>setRemoteError('가입 신청 조회 실패: '+error.message))
  },[isAdmin])
  async function signup(event:FormEvent<HTMLFormElement>){
    event.preventDefault()
    if(signupBusy)return
    const name=signupName.trim()
    if(name.length<2||name.length>40){setRemoteError('이름은 2~40자로 입력해 주세요.');return}
    if(loginPassword.length<12){setRemoteError('비밀번호는 12자 이상 입력해 주세요.');return}
    setSignupBusy(true);setRemoteError('')
    try{
      const email=staffEmailFromId(loginId)
      const credential=await createUserWithEmailAndPassword(auth,email,loginPassword)
      await set(ref(database,'roomLiveProfiles/'+credential.user.uid),{name,loginId:loginId.trim().toLowerCase(),createdAt:Date.now()})
      setLoginPassword('');setSignupMode(false)
    }catch(error){setRemoteError('회원가입 실패: '+(error instanceof Error?error.message:String(error)))}
    finally{setSignupBusy(false)}
  }
  async function approveStaff(uid:string,choice:'worker'|'observer'){
    if(!isAdmin||uid===ADMIN_UID||!staffProfiles[uid])return
    try{await set(ref(database,'roomLiveAccess/'+uid),choice)}catch(error){setRemoteError('승인 실패: '+String(error))}
  }
  async function changeStaffRole(uid:string,choice:'worker'|'observer'){
    if(!isAdmin||uid===ADMIN_UID||approvedStaff[uid]===choice)return
    try{await set(ref(database,'roomLiveAccess/'+uid),choice)}
    catch(error){setRemoteError('권한 변경 실패: '+String(error))}
  }
  async function revokeStaff(uid:string){
    if(!isAdmin)return
    askConfirm('직원 승인 취소','이 직원의 서버 접근 권한을 해제할까요?',()=>revokeStaffConfirmed(uid))
  }
  async function revokeStaffConfirmed(uid:string){
    if(!isAdmin)return
    try{await remove(ref(database,'roomLiveAccess/'+uid))}
    catch(error){setRemoteError('승인 해제 실패: '+String(error))}
  }
  function correctLedgerPayment(id:string){
    if(!isAdmin)return
    const original=store.payments.find(p=>p.id===id)
    if(!original)return
    setLedgerEdit({id,amount:String(original.amount),method:original.method,note:''})
  }
  function saveLedgerCorrection(){
    if(!isAdmin||!ledgerEdit)return
    const {id,amount,method,note}=ledgerEdit
    if(!/^\d+$/.test(amount.trim())||!Number.isSafeInteger(Number(amount))||Number(amount)<=0||Number(amount)>1000000000){notify('정정 금액을 1원 이상 10억원 이하로 입력해 주세요.');return}
    if(!note.trim()){notify('정정 사유를 입력해 주세요.');return}
    if(!['현금','카드','이체','미수'].includes(method)){notify('결제수단을 확인해 주세요.');return}
    askConfirm('장부 정정 확인','금액과 결제수단을 정정하고 변경 기록을 남길까요?',()=>{
      const at=Date.now(),logId=crypto.randomUUID()
      setLedger(previous=>{
        const current=previous.payments.find(p=>p.id===id)
        if(!current)return previous
        const next={...current,amount:Number(amount),method,correctedAt:at,correctionNote:note.trim()}
        return {...previous,payments:previous.payments.map(p=>p.id===id?next:p),logs:[{id:logId,at,room:current.room,roomUid:current.roomUid,action:'관리자 장부 정정 · '+current.method+' '+current.amount+'원 → '+next.method+' '+next.amount+'원 · 사유: '+note.trim()},...previous.logs]}
      })
      setLedgerEdit(null)
    },false)
  }
  function openCollect(id:string){
    if(!isAdmin||!store.payments.some(p=>p.id===id&&p.method==='미수'))return
    setCollectId(id);setCollectMethod(null);setCollectNote('')
  }
  function collectUnpaid(confirmed=false){
    if(!isAdmin||!collectId||!collectMethod)return
    const original=store.payments.find(p=>p.id===collectId&&p.method==='미수')
    if(!original){setCollectId(null);return}
    if(!confirmed){askConfirm('미수 회수','미수 '+original.amount.toLocaleString('ko-KR')+'원을 '+collectMethod+'으로 전액 회수할까요?',()=>collectUnpaid(true),false);return}
    const at=Date.now(),method=collectMethod,note=collectNote.trim(),id=collectId
    setLedger(previous=>{
      const current=previous.payments.find(p=>p.id===id&&p.method==='미수')
      if(!current)return previous
      return {...previous,payments:previous.payments.map(p=>p.id===id?{...p,method,correctedAt:at,correctionNote:'미수 회수: '+(note||'전액 회수')}:p),logs:[{id:crypto.randomUUID(),at,room:current.room,roomUid:current.roomUid,action:'미수 전액 회수 · '+method+' · '+current.amount+'원'+(note?' · '+note:'')},...previous.logs]}
    })
    setCollectId(null);setCollectMethod(null);setCollectNote('')
  }
  async function login(event:FormEvent<HTMLFormElement>){
    event.preventDefault()
    setRemoteError('')
    setLoginBusy(true)
    try{await signInWithEmailAndPassword(auth,loginEmailFromInput(loginId),loginPassword);setLoginPassword('')}
    catch(error){setRemoteError('로그인 실패: '+(error instanceof Error?error.message:String(error)))}
    finally{setLoginBusy(false)}
  }
  async function importLocal(confirmed=false){
    if(!isAdmin)return
    if(!confirmed){askConfirm('서버 최초 등록','이 휴대폰의 기존 데이터를 서버에 등록할까요? 기존 서버 데이터는 덮어쓰지 않습니다.',()=>{void importLocal(true)});return}
    setRemoteError('')
    try{
      const result=await runTransaction(roomLiveRef,current=>current===null?normalizeRemote(localInitial.current):undefined,{applyLocally:false})
      if(!result.committed)setRemoteError('서버에 이미 데이터가 존재합니다. 기존 데이터를 덮어쓰지 않았습니다.')
    }catch(error){setRemoteError('최초 등록 실패: '+(error instanceof Error?error.message:String(error)))}
  }
  const roomKey=(r:Room)=>r.uid??r.id
  const roomName=(uid:string)=>store.rooms.find(r=>roomKey(r)===uid)?.id??uid
  const sameRoom=(x:{room:string;roomUid?:string},uid:string)=>x.roomUid?x.roomUid===uid:x.room===roomName(uid)
  const attendance=(store.attendance??[]).filter(h=>!h.archivedAt)
  const attendanceTeams=store.attendanceTeams??[]
  const visibleAttendance=(attendanceTab==='all'?attendance:attendance.filter(h=>h.teamId===attendanceTab)).slice().sort((a,b)=>{const names=a.name.localeCompare(b.name,'ko');if(attendanceOrder==='name')return names;const office=(id?:string)=>attendanceTeams.find(t=>t.id===id)?.name??'미분류';return office(a.teamId).localeCompare(office(b.teamId),'ko')||names})
  const waiting=attendance.filter(h=>h.working&&!store.rooms.some(r=>r.tags.includes(h.id)))
  const helperName=(id:string)=>attendance.find(h=>h.id===id)?.name??id
  const shops = store.shops ?? seed.shops!
  const shopFor=(r:Room)=>groups.find(g=>g.id===r.groupId)?.shopId
  const duplicated=(name:string,shopId:string,exclude?:string)=>store.rooms.some(r=>r.id.toLocaleUpperCase()===name.toLocaleUpperCase()&&shopFor(r)===shopId&&roomKey(r)!==exclude)
  const renameShop=(id:string)=>{const current=shops.find(x=>x.id===id);if(!current)return;askInput('가게 이름 변경',current.name,value=>{const name=value.trim();if(!name)return;if(shops.some(x=>x.id!==id&&x.name.toLocaleLowerCase()===name.toLocaleLowerCase())){setRemoteError('이미 등록된 가게 이름입니다.');return}setStore(v=>({...v,shops:(v.shops??[]).map(x=>x.id===id?{...x,name}:x)}))})}
  const groups = store.groups ?? seed.groups!
  function finishRoom(id:string){
    if(!canOperate||!readyRef.current)return
    const at=Date.now(),requestedBy=auth.currentUser?.uid
    const operation=async()=>{
      if(!requestedBy||auth.currentUser?.uid!==requestedBy||!readyRef.current)return
      try{
        const target=v2Active?ref(database,OPERATIONS_PATH):roomLiveRef
        const result=await runTransaction(target,current=>{
          if(!current)return
          const previous=normalizeRemote(v2Active?{...current,payments:v2PaymentsRef.current} as Store:current as Store)
          const room=previous.rooms.find(r=>(r.uid??r.id)===id)
          if(!room||room.cleaning||room.started===null)return
          const sessions=previous.sessions.filter(x=>(x.roomUid?x.roomUid===id:x.room===room.id)&&x.ended===null)
          if(sessions.length>1)return
          const next:Store={...previous,
            rooms:previous.rooms.map(r=>(r.uid??r.id)===id?{...r,started:null,ends:null,tags:[],headcount:0,cleaning:true}:r),
            visits:previous.visits.map(v=>v.exited===null&&(v.roomUid?v.roomUid===id:v.room===room.id)?{...v,exited:at}:v),
            sessions:previous.sessions.map(x=>x.ended===null&&(x.roomUid?x.roomUid===id:x.room===room.id)?{...x,ended:at}:x),
            logs:[{id:crypto.randomUUID(),at,room:room.id,roomUid:id,action:'마무리 · 청소대기중'},...previous.logs]
          }
          return v2Active?toOperations(next):next
        },{applyLocally:false})
        if(!result.committed){notify('마무리를 저장하지 못했습니다. 방 상태를 확인해 주세요.');return}
        setDetail(null);setChosen([]);setPage('rooms')
      }catch(error){setRemoteError('마무리 실패: '+String(error))}
    }
    transactionQueue.current=transactionQueue.current.then(operation,operation)
  }
  function clearCleaning(id:string){
    setStore(previous=>{
      const room=previous.rooms.find(r=>(r.uid??r.id)===id)
      if(!room?.cleaning)return previous
      return {...previous,rooms:previous.rooms.map(r=>(r.uid??r.id)===id?{...r,cleaning:false,started:null,ends:null,tags:[],headcount:0}:r),
        logs:[{id:crypto.randomUUID(),at:Date.now(),room:room.id,roomUid:id,action:'청소 완료 · 빈방'},...previous.logs]}
    })
  }
  function cancelRoom(id:string,confirmed=false) {
    if(!canOperate||!readyRef.current)return
    if(!confirmed){askConfirm('진행삭제','결제 없이 방을 종료하고 진행 기록만 남길까요?',()=>cancelRoom(id,true));return}
    const at=Date.now(),logId=crypto.randomUUID(),requestedBy=auth.currentUser?.uid
    const operation=async()=>{
      if(!requestedBy||auth.currentUser?.uid!==requestedBy||!readyRef.current)return
      try{
        const target=v2Active?ref(database,OPERATIONS_PATH):roomLiveRef
        const result=await runTransaction(target,current=>{
          if(!current)return
          const previous=normalizeRemote(v2Active?{...current,payments:v2PaymentsRef.current} as Store:current as Store)
          const next=applyCancelRoom(previous,id,at,logId)
          return next?(v2Active?toOperations(next):next):undefined
        },{applyLocally:false})
        if(!result.committed){notify('진행삭제가 저장되지 않았습니다. 방이 이미 공실인지 확인해 주세요. 계속 실패하면 방 번호를 알려주세요.');return}
        setDetail(null);setCheckout(null);setAdjust(null)
      }catch(error){const message=error instanceof Error?error.message:String(error);setRemoteError('진행삭제 실패: '+message);notify('진행삭제 저장 실패: '+message)}
    }
    transactionQueue.current=transactionQueue.current.then(operation,operation)
  }
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  function changeTime(id: string, minutes: number) {
    const time=Date.now(),sessionId=crypto.randomUUID(),logId=crypto.randomUUID()
    setStore(s=>{
      const room=s.rooms.find(r=>roomKey(r)===id)
      if(!room||room.cleaning||(!room.ends&&minutes<0))return s
      const openSessions=s.sessions.filter(x=>sameRoom(x,id)&&x.ended===null)
      if(openSessions.length>1||(room.started===null&&openSessions.length>0))return s
      const nextEnd=Math.max(time+60000,(room.ends??time)+minutes*60000)
      return {...s,
        rooms:s.rooms.map(r=>roomKey(r)!==id?r:{...r,started:r.started??time,ends:nextEnd}),
        logs:[{id:logId,at:time,room:room.id,roomUid:id,action:`시간 ${minutes>0?'+':''}${minutes}분 · 변경 전 ${room.ends?format(room.ends-time):'대기'} → 변경 후 ${format(nextEnd-time)}`},...s.logs],
        sessions:room.started!==null?s.sessions:[{id:sessionId,room:room.id,roomUid:id,started:time,ended:null},...s.sessions]
      }
    })
  }
  function setRemainingMinutes(id:string,input:string){
    const trimmed=input.trim()
    if(!/^[0-9]{1,5}$/.test(trimmed)){notify('남은 시간을 분 단위 숫자로 입력해 주세요. 예: 34');return}
    const minutes=Number(trimmed)
    if(minutes<1||minutes>99999){notify('1~99999분 사이로 입력해 주세요.');return}
    const at=Date.now(),sessionId=crypto.randomUUID(),logId=crypto.randomUUID()
    setStore(s=>{
      const room=s.rooms.find(r=>roomKey(r)===id)
      if(!room||room.cleaning)return s
      const open=s.sessions.filter(x=>sameRoom(x,id)&&x.ended===null)
      if(open.length>1||(room.started===null&&open.length>0))return s
      const ends=at+minutes*60000
      return {...s,
        rooms:s.rooms.map(r=>roomKey(r)===id?{...r,started:r.started??at,ends}:r),
        sessions:room.started!==null?s.sessions:[{id:sessionId,room:room.id,roomUid:id,started:at,ended:null},...s.sessions],
        logs:[{id:logId,at,room:room.id,roomUid:id,action:`남은 시간 직접 설정 ${minutes}분 · 변경 전 ${room.ends?format(room.ends-at):'대기'}`},...s.logs]
      }
    })
    setDirectMinutes('')
  }
  function start(id: string) {
    const at=Date.now(),sessionId=crypto.randomUUID(),logId=crypto.randomUUID()
    setStore(s=>{
      const room=s.rooms.find(r=>roomKey(r)===id)
      if(!room||room.cleaning||room.started!==null||s.sessions.some(x=>sameRoom(x,id)&&x.ended===null))return s
      return {...s,
        rooms:s.rooms.map(r=>roomKey(r)===id?{...r,started:at,ends:at+3600000}:r),
        sessions:[{id:sessionId,room:room.id,roomUid:id,started:at,ended:null},...s.sessions],
        logs:[{id:logId,at,room:room.id,roomUid:id,action:'방 시작 · 60분'},...s.logs]
      }
    })
  }
  function saveCheckout() {
    if (!checkout || !payMethod) { notify('결제 수단을 선택해 주세요.'); return }
    if (!/^\d+$/.test(payAmount.trim()) || !Number.isSafeInteger(Number(payAmount)) || Number(payAmount) <= 0 || Number(payAmount) > 1000000000) { notify('결제금액을 1원 이상의 숫자로 입력해 주세요.'); return }
    if(!canOperate||!readyRef.current){notify('서버 연결 후 결제할 수 있습니다.');return}
    if(checkoutPendingRef.current)return
    checkoutPendingRef.current=true
    setCheckoutSaving(true)
    const roomUid=checkout, method=payMethod, amount=Number(payAmount), at=Date.now()
    const manager=payManager.trim(), memo=payMemo.trim(), wari=payWari.trim(), wt=payWt.trim()
    const paymentId=crypto.randomUUID()
    if(v2Active){
      const operation=async()=>{
        try{
          if(!account||auth.currentUser?.uid!==account.uid)throw Error('로그인 상태가 변경되었습니다.')
          const requestRef=ref(database,CHECKOUT_PATH+'/'+paymentId)
          await set(requestRef,{id:paymentId,uid:account.uid,roomUid,amount,method,at,manager,memo,wari,wt})
          const {get}=await import('firebase/database')
          let status='pending'
          for(let attempt=0;attempt<30;attempt++){
            await new Promise(resolve=>setTimeout(resolve,500))
            const snapshot=await get(requestRef)
            status=snapshot.child('status').val()??'pending'
            if(status==='completed'||status==='rejected')break
          }
          if(status==='completed'){
            setCheckout(null);setDetail(null);setPayMethod(null);setPayAmount('');setPayManager('');setPayMemo('')
          }else if(status==='rejected')notify('서버에서 결제를 거절했습니다. 방 상태와 권한을 확인하세요.')
          else notify('결제 요청을 제출했습니다. 처리 결과를 확인한 뒤 다시 시도하세요.')
        }catch(error){setRemoteError('결제 요청 실패: '+String(error));notify('결제 요청 실패. 저장 여부를 확인한 뒤 다시 시도하세요.')}
        finally{checkoutPendingRef.current=false;setCheckoutSaving(false)}
      }
      transactionQueue.current=transactionQueue.current.then(operation,operation)
      return
    }
    const operation=async()=>{
      try{
        const result=await runTransaction(roomLiveRef,current=>{
          if(current===null)return
          const previous=normalizeRemote(current as Store)
          return applyCheckout(previous,{paymentId,roomUid,method,amount,at,manager,memo,wari,wt})
        },{applyLocally:false})
        if(!result.committed){notify('이미 마감됐거나 다른 사용자가 방 상태를 변경했습니다. 최신 상태를 확인해 주세요.');return}
        setCheckout(null);setDetail(null);setPayMethod(null);setPayAmount('');setPayManager('');setPayMemo('')
      }catch(error){setRemoteError('결제 저장 실패: '+String(error));notify('결제 저장 실패. 저장 결과를 확인한 후 다시 시도해 주세요.')}
      finally{checkoutPendingRef.current=false;setCheckoutSaving(false)}
    }
    transactionQueue.current=transactionQueue.current.then(operation,operation)
  }
  function placeMany(ids:string[],destination:string|null){
    const valid=[...new Set(ids)].filter(id=>attendance.some(h=>h.id===id&&h.working))
    if(!valid.length)return
    const at=Date.now()
    setStore(s=>{
      const target=s.rooms.find(r=>roomKey(r)===destination)
      if(destination&&(!target||target.cleaning))return s
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
    setDetail(null)
  }
  function updateAttendanceTeam(personId:string,teamId:string){
    if(!readyRef.current||!canOperate)return
    if(teamId&&!(store.attendanceTeams??[]).some(t=>t.id===teamId)){notify('존재하지 않는 소속입니다.');return}
    const requestedBy=auth.currentUser?.uid
    setAttendanceTeamSaving(v=>({...v,[personId]:true}))
    const operation=async()=>{
      try{
        if(!requestedBy||auth.currentUser?.uid!==requestedBy||!readyRef.current)throw Error('서버 연결 또는 로그인 상태를 확인해 주세요.')
        const target=v2Active?ref(database,OPERATIONS_PATH):roomLiveRef
        const result=await runTransaction(target,current=>{
          if(!current)return
          const previous=normalizeRemote(v2Active?{...current,payments:v2PaymentsRef.current} as Store:current as Store)
          if(!previous.attendance?.some(h=>h.id===personId))return
          const next={...previous,attendance:previous.attendance.map(h=>h.id===personId?{...h,teamId}:h)}
          return v2Active?toOperations(next):next
        },{applyLocally:false})
        if(!result.committed)throw Error('소속 변경이 서버에 저장되지 않았습니다.')
        const saved=normalizeRemote(result.snapshot.val() as Store)
        if(saved.attendance?.find(h=>h.id===personId)?.teamId!==teamId)throw Error('서버에 저장된 소속이 선택값과 다릅니다.')
        setRemoteError('')
      }catch(error){const message='소속 변경 실패: '+(error instanceof Error?error.message:String(error));setRemoteError(message);notify(message)}
      finally{setAttendanceTeamSaving(v=>({...v,[personId]:false}))}
    }
    transactionQueue.current=transactionQueue.current.then(operation,operation)
  }
  function toggleAttendance(id:string,confirmed=false){
    const h=attendance.find(x=>x.id===id);if(!h)return
    if(h.working&&store.rooms.some(r=>r.tags.includes(id))){
      if(!confirmed){askConfirm('퇴근 확인',h.name+' 님이 방에 배치되어 있습니다. 퇴실 후 퇴근 처리할까요?',()=>toggleAttendance(id,true));return}
    }
    const at=Date.now()
    setStore(s=>{
      const current=(s.attendance??[]).find(x=>x.id===id)
      if(!current)return s
      const working=!current.working
      const shifts=s.attendanceShifts??[]
      const open=shifts.some(x=>x.tag===id&&x.clockOut===null)
      return {...s,
        attendance:(s.attendance??[]).map(x=>x.id===id?{...x,working}:x),
        attendanceShifts:working?(open?shifts:[{id:crypto.randomUUID(),tag:id,clockIn:at,clockOut:null},...shifts]):shifts.map(x=>x.tag===id&&x.clockOut===null?{...x,clockOut:at}:x),
        rooms:working?s.rooms:s.rooms.map(r=>({...r,tags:r.tags.filter(tag=>tag!==id)})),
        visits:working?s.visits:s.visits.map(v=>v.tag===id&&v.exited===null?{...v,exited:at}:v),
        logs:[{id:crypto.randomUUID(),at,room:'출근부',action:current.name+(working?' 출근':' 퇴근')},...s.logs]
      }
    })
    setChosen(v=>v.filter(x=>x!==id))
  }
  async function deleteAttendance(id:string){
    if(!canOperate||!readyRef.current||attendanceDeleting)return
    const person=attendance.find(h=>h.id===id)
    if(!person)return
    setAttendanceDeleting(true)
    const at=Date.now()
    const requestedBy=auth.currentUser?.uid
    const operation=async()=>{
      if(!requestedBy||auth.currentUser?.uid!==requestedBy||!readyRef.current)throw Error('서버 연결 상태를 확인해 주세요.')
      const target=v2Active?ref(database,OPERATIONS_PATH):roomLiveRef
      const result=await runTransaction(target,current=>{
        if(!current)return
        const previous=normalizeRemote(v2Active?{...current,payments:v2PaymentsRef.current} as Store:current as Store)
        const member=previous.attendance?.find(h=>h.id===id&&!h.archivedAt)
        if(!member)return
        if(previous.rooms.some(room=>room.tags.includes(id)))return
        return v2Active?toOperations({...previous,attendance:previous.attendance!.map(h=>h.id===id?{...h,working:false,archivedAt:at}:h),attendanceShifts:(previous.attendanceShifts??[]).map(x=>x.tag===id&&x.clockOut===null?{...x,clockOut:at}:x),logs:[{id:crypto.randomUUID(),at,room:'출근부',action:member.name+' 출근부 삭제'},...previous.logs]}):{...previous,attendance:previous.attendance!.map(h=>h.id===id?{...h,working:false,archivedAt:at}:h),attendanceShifts:(previous.attendanceShifts??[]).map(x=>x.tag===id&&x.clockOut===null?{...x,clockOut:at}:x),logs:[{id:crypto.randomUUID(),at,room:'출근부',action:member.name+' 출근부 삭제'},...previous.logs]}
      },{applyLocally:false})
      if(!result.committed)throw Error('삭제할 수 없습니다. 방에 배치되어 있으면 먼저 퇴실 처리해 주세요.')
    }
    try{await (transactionQueue.current=transactionQueue.current.then(operation,operation));setAttendanceDeleteId(null);setRemoteError('')}
    catch(error){const message='출근자 삭제 실패: '+String(error);setRemoteError(message);notify(message)}
    finally{setAttendanceDeleting(false)}
  }
  function renameAttendance(id:string){
    const h=attendance.find(x=>x.id===id);if(!h)return
    askInput('출근부 이름 수정',h.name,value=>{
      const name=value.trim()
      if(!name)return
      if(attendance.some(x=>x.id!==id&&x.name.toLocaleLowerCase()===name.toLocaleLowerCase())){setRemoteError('이미 등록된 이름입니다.');return}
      setStore(s=>({...s,attendance:(s.attendance??[]).map(x=>x.id===id?{...x,name}:x)}))
    })
  }
  function changeRoomHeadcount(id:string,count:number){
    if(!canOperate||!readyRef.current||!Number.isInteger(count)||count<1||count>16)return
    const at=Date.now(),requestedBy=auth.currentUser?.uid,logId=crypto.randomUUID()
    const operation=async()=>{
      if(!requestedBy||auth.currentUser?.uid!==requestedBy||!readyRef.current)return
      const target=v2Active?ref(database,OPERATIONS_PATH):roomLiveRef
      try{
        const result=await runTransaction(target,current=>{
          if(!current)return
          const previous=normalizeRemote(v2Active?{...current,payments:v2PaymentsRef.current} as Store:current as Store)
          const room=previous.rooms.find(r=>roomKey(r)===id)
          if(!room)return
          if(room.headcount===count)return
          const next={...previous,rooms:previous.rooms.map(r=>roomKey(r)===id?{...r,headcount:count}:r),logs:[{id:logId,at,room:room.id,roomUid:id,action:'인원수 '+count+'명 설정'},...previous.logs]}
          return v2Active?toOperations(next):next
        },{applyLocally:false})
        if(!result.committed)throw Error('인원수 저장이 완료되지 않았습니다.')
      }catch(error){const message='인원수 변경 실패: '+String(error);setRemoteError(message);notify(message)}
    }
    transactionQueue.current=transactionQueue.current.then(operation,operation)
  }
  function openHeadcountMenu(event:MouseEvent<HTMLButtonElement>,id:string){
    event.preventDefault();event.stopPropagation()
    if(!canOperate||editing)return
    if(headcountMenu?.id===id){setHeadcountMenu(null);return}
    const rect=event.currentTarget.getBoundingClientRect()
    const height=Math.min(240,window.innerHeight-100)
    const top=rect.bottom+height+8>window.innerHeight?Math.max(8,rect.top-height-5):rect.bottom+5
    setHeadcountMenu({id,top,left:Math.max(8,Math.min(rect.left,window.innerWidth-112)),width:Math.max(92,rect.width)})
  }
  function outSelectedFromRoom(ids:string[]){
    const unique=[...new Set(ids)]
    if(!unique.length||outBusy||!canOperate||!readyRef.current)return
    const requestedBy=auth.currentUser?.uid,at=Date.now()
    setOutBusy(true)
    const operation=async()=>{
      try{
        if(!requestedBy||auth.currentUser?.uid!==requestedBy||!readyRef.current)throw Error('로그인 및 서버 연결을 확인해 주세요.')
        const target=v2Active?ref(database,OPERATIONS_PATH):roomLiveRef
        const result=await runTransaction(target,current=>{
          if(!current)return
          const previous=normalizeRemote(v2Active?{...current,payments:v2PaymentsRef.current} as Store:current as Store)
          const leaving=previous.rooms.flatMap(r=>r.tags.filter(tag=>unique.includes(tag)).map(tag=>({tag,room:r})))
          if(!leaving.length)return
          const ids=leaving.map(x=>x.tag)
          const logs=leaving.map(({tag,room})=>({id:crypto.randomUUID(),at,room:room.id,roomUid:roomKey(room),action:(previous.attendance?.find(h=>h.id===tag)?.name??tag)+' OUT (방 퇴실)'}))
          const next={...previous,
            rooms:previous.rooms.map(r=>({...r,tags:r.tags.filter(tag=>!ids.includes(tag))})),
            visits:previous.visits.map(v=>ids.includes(v.tag)&&v.exited===null?{...v,exited:at}:v),
            logs:[...logs,...previous.logs]
          }
          return v2Active?toOperations(next):next
        },{applyLocally:false})
        if(!result.committed)throw Error('이미 퇴실했거나 변경 내용을 저장하지 못했습니다.')
        setChosen([])
        setRemoteError('')
      }catch(error){const message='OUT 처리 실패: '+String(error);setRemoteError(message);notify(message)}
      finally{setOutBusy(false)}
    }
    transactionQueue.current=transactionQueue.current.then(operation,operation)
  }
  function roomTap(id: string) {
    if (held.current) { held.current = false; return }
    if (editing) return
    if(store.rooms.find(r=>roomKey(r)===id)?.cleaning){if(canOperate)clearCleaning(id);return}
    if (chosen.length) { placeMany(chosen, id); return }
    const t = Date.now()
    if (tap.current?.room === id && t - tap.current.time < 350) { tap.current = null; changeTime(id, 60) }
    else { tap.current = { room: id, time: t }; setTimeout(() => { if (tap.current?.room === id && tap.current.time === t) { tap.current = null; setDetail(id) } }, 360) }
  }
  const selected = store.rooms.find(r => roomKey(r) === detail)
  if(authLoading)return <div className="cloud-gate"><h1>ROOM LIVE</h1><p>로그인 상태 확인 중...</p></div>
  if(!account)return <div className="cloud-gate"><h1>ROOM LIVE</h1><p>{signupMode?'직원 회원가입':'직원 아이디 또는 관리자 이메일로 로그인'}</p><form onSubmit={signupMode?signup:login}>{signupMode&&<label>이름<input required minLength={2} maxLength={40} value={signupName} onChange={e=>setSignupName(e.target.value)}/></label>}<label>아이디{!signupMode?' 또는 관리자 이메일':''}<input type="text" autoCapitalize="none" autoComplete="username" required value={loginId} onChange={e=>setLoginId(e.target.value)}/></label><label>비밀번호<input type="password" minLength={signupMode?12:undefined} autoComplete={signupMode?'new-password':'current-password'} required value={loginPassword} onChange={e=>setLoginPassword(e.target.value)}/></label><button disabled={loginBusy||signupBusy} type="submit">{signupMode?'가입 신청':'로그인'}</button></form><button type="button" onClick={()=>{setSignupMode(!signupMode);setRemoteError('')}}>{signupMode?'로그인으로 돌아가기':'직원 회원가입'}</button>{remoteError&&<p role="alert" className="cloud-error">{remoteError}</p>}</div>
  if(role==='observer')return <div className="app"><header><div><span className="kicker">ROOM LIVE</span><h1>방 현황</h1><p>조회 전용</p></div><button onClick={()=>signOut(auth)}>로그아웃</button></header><main>{remoteState==='loading'&&<p>서버 현황을 불러오는 중...</p>}{remoteState==='empty'&&<p>아직 공개된 방 현황이 없습니다. 관리자에게 현황 갱신을 요청해 주세요.</p>}{remoteState==='error'&&<p className="cloud-error">{remoteError}</p>}{observerData&&<><p className="hint">방 {observerData.rooms?.length??0}개 · 마지막 갱신 {new Date(observerData.updatedAt).toLocaleTimeString('ko-KR')}</p><div className="observer-grid">{(observerData.rooms??[]).map(r=><div className="observer-room" key={r.uid}><strong>{r.name}</strong><small>{r.shop} · {r.group}</small><b>{r.ends?format(r.ends-now):'대기'}</b><small>입실 {r.headcount}명</small></div>)}</div></>}</main></div>
  if(role==='pending')return <div className="cloud-gate"><h1>ROOM LIVE</h1><p>가입 신청이 접수되었습니다. 관리자 승인 후 이용할 수 있습니다.</p><button onClick={()=>signOut(auth)}>로그아웃</button></div>
  if(remoteState!=='ready')return <div className="cloud-gate"><h1>ROOM LIVE</h1><p>{remoteState==='empty'?'서버 데이터가 아직 없습니다.':remoteState==='error'?'서버 연결에 실패했습니다.':'실시간 서버 데이터 연결 중...'}</p>{remoteState==='empty'&&isAdmin&&<><p>최초 한 번만 이 휴대폰의 기존 데이터를 서버에 등록합니다. 다른 휴대폰에서는 이 버튼을 누르지 마세요.</p><button onClick={()=>{void importLocal()}}>이 휴대폰 데이터로 서버 시작</button></>}{remoteError&&<p role="alert" className="cloud-error">{remoteError}</p>}<button onClick={()=>signOut(auth)}>로그아웃</button></div>
  return <div className="app">
    <header className="compact-header"><h1>룸 라이브</h1><span className="app-version">v0.5.2</span></header>
    {page === 'rooms' && <main className="room-board">
      <div className="section"><h2>방 현황 <small>{store.rooms.length}개</small></h2><button onClick={() => { if(!canOperate)return;setEditing(!editing); setMoving(null); setChosen([]) }}>{editing ? '편집 완료' : '배치 편집'}</button></div>
      <div className="shop-tabs"><button className={shopTab==='all'?'active':''} onClick={()=>setShopTab('all')}>전체</button>{shops.map(sh=><button key={sh.id} className={shopTab===sh.id?'active':''} onClick={()=>setShopTab(sh.id)}>{sh.name}</button>)}</div>
      {shops.filter(sh=>shopTab==='all'||sh.id===shopTab).map(sh=><div className="shop-section" key={sh.id}><div className="shop-divider"><span>{sh.name}</span></div>{editing&&<button className="manage-add" onClick={()=>askInput(sh.name+' 새 묶음 이름','',value=>{const name=value.trim();if(!name)return;if(groups.some(g=>g.shopId===sh.id&&g.name.toLocaleLowerCase()===name.toLocaleLowerCase())){setRemoteError('같은 가게에 이미 있는 묶음 이름입니다.');return}setStore(v=>({...v,groups:[...(v.groups??[]),{id:crypto.randomUUID(),shopId:sh.id,name,layout:[]}]}))})}>+ {sh.name} 묶음 추가</button>}{groups.filter(g=>g.shopId===sh.id).map(g=>{
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
          <div className="room-grid three-cols">{(editing?positions:positions.filter(id=>id!==null)).map((id,index)=>{
            const r=groupRooms.find(x=>roomKey(x)===id)
            if(!r)return <button key={'empty'+index} className={'empty-slot '+(editing?'editable':'')} disabled={!editing} onClick={()=>{if(moving)move(moving,index)}}>{editing?'＋ 빈칸':''}</button>
            const expired=Boolean(r.ends&&r.ends<=now)
            const remaining=r.ends===null?null:r.ends-now
            const roomVisualState=r.cleaning?'cleaning':r.started!==null?(remaining!==null&&remaining<180000?'critical':remaining!==null&&remaining<=600000?'warning':'active'):(r.headcount&&r.headcount>=1?'choice':'idle')
            return <div key={roomKey(r)} className={'room room-state-'+roomVisualState+' '+(r.ends?'running ':'')+(expired?'expired ':'')+(moving===roomKey(r)?'moving':'')}
              onClick={()=>editing?(moving?move(moving,index):setMoving(roomKey(r))):roomTap(roomKey(r))}
              onPointerDown={e=>{touchStart.current={x:e.clientX,y:e.clientY};held.current=false;if(!editing&&!chosen.length&&!r.cleaning)hold.current=setTimeout(()=>{held.current=true;setDetail(null);setAdjust(roomKey(r))},550)}}
              onPointerMove={e=>{if(touchStart.current&&Math.hypot(e.clientX-touchStart.current.x,e.clientY-touchStart.current.y)>12&&hold.current)clearTimeout(hold.current)}}
              onPointerUp={()=>{if(hold.current)clearTimeout(hold.current)}} onPointerLeave={()=>{if(hold.current)clearTimeout(hold.current)}} onPointerCancel={()=>{if(hold.current)clearTimeout(hold.current)}}
              onContextMenu={e=>{e.preventDefault();if(!editing&&!chosen.length&&!r.cleaning){held.current=true;setAdjust(roomKey(r))}}}>
              <div className="room-head"><strong>{r.id}</strong><div className="room-head-controls"><button type="button" className="room-headcount" aria-label={r.id+' 인원수 선택'} aria-expanded={headcountMenu?.id===roomKey(r)} disabled={!canOperate||editing||r.cleaning} onPointerDown={e=>e.stopPropagation()} onPointerUp={e=>e.stopPropagation()} onClick={e=>openHeadcountMenu(e,roomKey(r))}>{r.headcount?r.headcount+'명':'인원'} <span aria-hidden="true">⌄</span></button><span>{roomVisualState==='cleaning'?'청소대기중':roomVisualState==='choice'?'초이스 대기 중':roomVisualState==='critical'?(expired?'시간 종료':'종료 직전'):roomVisualState==='warning'?'종료 임박':roomVisualState==='active'?'진행 중':'대기'}</span></div></div>
              {r.cleaning&&<div className="room-cleaning-message">청소대기중 · 터치하면 빈방</div>}{r.started!==null&&<div className="room-entry-time">{new Date(r.started).toLocaleTimeString('ko-KR',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Asia/Seoul'})}</div>}
              <div className="time">{r.cleaning?'청소대기중':r.ends?format(r.ends-now):'--:--:--'}</div>
              <div className="tags room-inline-staff">{r.tags.length?r.tags.map(tag=><button type="button" key={tag} className={'room-staff-choice '+(chosen.includes(tag)?'selected':'')} aria-pressed={chosen.includes(tag)} onClick={e=>{e.stopPropagation();setChosen(prev=>prev.includes(tag)?prev.filter(x=>x!==tag):[...prev,tag])}}>{helperName(tag)}</button>):'배치 인원 없음'}</div>
              {editing&&<div className="room-tools"><button onClick={e=>{e.stopPropagation();askInput('방 이름 변경',r.id,value=>{const name=value.trim().toUpperCase();if(!name||name===r.id)return;if(duplicated(name,g.shopId,roomKey(r))){setRemoteError('같은 가게에 이미 등록된 방 이름입니다.');return}setStore(v=>({...v,rooms:v.rooms.map(x=>roomKey(x)===roomKey(r)?{...x,id:name}:x),logs:v.logs.map(x=>sameRoom(x,roomKey(r))?{...x,room:name}:x),visits:v.visits.map(x=>sameRoom(x,roomKey(r))?{...x,room:name}:x),sessions:v.sessions.map(x=>sameRoom(x,roomKey(r))?{...x,room:name}:x),payments:v.payments.map(x=>sameRoom(x,roomKey(r))?{...x,room:name}:x)}))})}}>이름</button><button onClick={e=>{e.stopPropagation();if(r.started||r.tags.length){setRemoteError('진행 중인 방은 이동할 수 없습니다.');return}askInput('이동할 묶음 이름',g.name,value=>{const dest=value.trim();const target=groups.find(x=>x.name===dest&&x.id!==g.id);if(!target){setRemoteError('이동할 묶음을 찾을 수 없습니다.');return}if(duplicated(r.id,target.shopId)){setRemoteError('이동할 가게에 같은 이름의 방이 있습니다.');return}setStore(v=>({...v,rooms:v.rooms.map(x=>roomKey(x)===roomKey(r)?{...x,groupId:target.id}:x),groups:(v.groups??[]).map(x=>x.id===g.id?{...x,layout:x.layout.map(y=>y===roomKey(r)?null:y)}:x)}))})}}>이동</button><button onClick={e=>{e.stopPropagation();if(r.started||r.tags.length){setRemoteError('이용 중인 방은 삭제할 수 없습니다.');return}askConfirm('방 삭제',r.id+' 방을 삭제할까요?',()=>setStore(v=>({...v,rooms:v.rooms.filter(x=>roomKey(x)!==roomKey(r)),groups:(v.groups??[]).map(x=>({...x,layout:x.layout.map(y=>y===roomKey(r)?null:y)}))})))}}>삭제</button></div>}
              

            </div>
          })}</div>
        </section>
      })}</div>)}
      <div className="section"><h2>출근부 · 대기 <small>{waiting.length}명</small></h2><button onClick={()=>setPage('attendance')}>출근부 관리</button></div>
      
      <div className="tag-list">{waiting.map(h=><button key={h.id} className={chosen.includes(h.id)?'picked':''} onClick={()=>setChosen(v=>v.includes(h.id)?v.filter(x=>x!==h.id):[...v,h.id])}>{h.name}<small>{chosen.includes(h.id)?'✓ 선택됨':'대기'}</small></button>)}</div>
      
      {!waiting.length&&<p className="hint">출근 중인 대기 인원이 없습니다. 출근부에서 출근 처리해 주세요.</p>}
      
    </main>}
    {page==='logs'&&<main><div className="section"><h2>{historyRoom ? roomName(historyRoom)+' 진행 기록' : '방별 진행 기록'}</h2>{historyRoom&&<button onClick={()=>setHistoryRoom(null)}>← 방 목록</button>}</div>
      {!historyRoom?<div className="history-rooms">{store.rooms.map(r=><button key={roomKey(r)} onClick={()=>{setHistoryRoom(roomKey(r));setDay('')}}><strong>{r.id}</strong><span>{shops.find(sh=>sh.id===shopFor(r))?.name} · {groups.find(g=>g.id===r.groupId)?.name}<small>이용 회차 {store.sessions.filter(x=>sameRoom(x,roomKey(r))).length}건 · 결제 {store.payments.filter(x=>sameRoom(x,roomKey(r))).length}건</small></span><b>›</b></button>)}</div>:<><div className="filters"><input type="date" value={day} onChange={e=>setDay(e.target.value)}/><button onClick={()=>setDay('')}>전체 날짜</button></div>
      <h3>이용 회차</h3><div className="sessions">{store.sessions.filter(x=>sameRoom(x,historyRoom)&&(!day||new Date(x.started).toLocaleDateString('sv-SE')===day)).map(x=><button key={x.id} onClick={()=>setViewSession(x.id)}>{date(x.started)} · {x.ended?'종료':'진행 중'} ›</button>)}</div>
      <h3>결제 내역</h3><div className="logs">{store.payments.filter(x=>sameRoom(x,historyRoom)&&(!day||new Date(x.at).toLocaleDateString('sv-SE')===day)).map(x=><div className="log" key={x.id}><b>{x.method}</b><div><strong>{x.amount.toLocaleString('ko-KR')}원</strong><small>{date(x.at)}</small>{x.manager&&<small>담당: {x.manager}</small>}{x.wari&&<small>와리: {x.wari}</small>}{x.wt&&<small>WT: {x.wt}</small>}{x.memo&&<small>비고: {x.memo}</small>}</div></div>)}</div>
      <h3>활동 로그</h3><div className="logs">{store.logs.filter(x=>sameRoom(x,historyRoom)&&(!day||new Date(x.at).toLocaleDateString('sv-SE')===day)).map(x=><div className="log" key={x.id}><b>{x.room}</b><div><strong>{x.action}</strong><small>{date(x.at)}</small></div></div>)}</div></>}
    </main>}
    {page==='attendance'&&<main><div className="section"><h2>출근부 <small>출근 {attendance.filter(h=>h.working).length}명 / 전체 {attendance.length}명</small></h2><button onClick={()=>{setAttendanceNewName('');setAttendanceNewTeam(attendanceTab==='all'?'':attendanceTab);setAttendanceAddError('');setAttendanceAddOpen(true)}}>+ 이름 추가</button></div><div className="shop-tabs"><button className={attendanceTab==='all'?'active':''} onClick={()=>setAttendanceTab('all')}>전체</button>{attendanceTeams.map(team=><button key={team.id} className={attendanceTab===team.id?'active':''} onClick={()=>setAttendanceTab(team.id)}>{team.name}</button>)}<button onClick={()=>askInput('새 출근부 탭','',value=>{const name=value.trim();if(!name)return;if(name.length>30||name==='전체'||attendanceTeams.some(t=>t.name.toLocaleLowerCase()===name.toLocaleLowerCase())){setRemoteError('탭 이름은 30자 이내의 중복되지 않는 이름이어야 합니다.');return}const id=crypto.randomUUID();setStore(v=>({...v,attendanceTeams:[...(v.attendanceTeams??[]),{id,name}]}));setAttendanceTab(id)})}>+ 탭 추가</button></div>{attendanceTab!=='all'&&<div className="section"><span className="hint">선택한 소속 {visibleAttendance.length}명</span><button onClick={()=>{const team=attendanceTeams.find(t=>t.id===attendanceTab);if(!team)return;askInput('탭 이름 변경',team.name,value=>{const name=value.trim();if(!name||name===team.name)return;if(name.length>30||name==='전체'||attendanceTeams.some(t=>t.id!==team.id&&t.name.toLocaleLowerCase()===name.toLocaleLowerCase())){setRemoteError('탭 이름을 확인해 주세요.');return}setStore(v=>({...v,attendanceTeams:(v.attendanceTeams??[]).map(t=>t.id===team.id?{...t,name}:t)}))})}}>탭 이름 변경</button><button onClick={()=>{const team=attendanceTeams.find(t=>t.id===attendanceTab);if(!team)return;askConfirm('탭 삭제',team.name+' 탭을 삭제할까요? 소속 인원은 미분류로 이동합니다.',()=>{setStore(v=>({...v,attendanceTeams:(v.attendanceTeams??[]).filter(t=>t.id!==team.id),attendance:(v.attendance??[]).map(h=>h.teamId===team.id?{...h,teamId:''}:h)}));setAttendanceTab('all')})}}>탭 삭제</button></div>}<div className="section attendance-edit-bar"><label className="attendance-order-label">배치 순서 <select aria-label="출근부 배치 순서" value={attendanceOrder} onChange={e=>setAttendanceOrder(e.target.value as 'name'|'office')}><option value="name">이름순</option><option value="office">사무실별</option></select></label><button className={attendanceTeamEditing?'active':''} onClick={()=>setAttendanceTeamEditing(v=>!v)}>{attendanceTeamEditing?'분류 수정 완료':'분류 수정'}</button></div><div className="attendance-list">{visibleAttendance.map(h=><div key={h.id} className={h.working?"attendance-item working":"attendance-item"}><div className="attendance-name-row"><button className="attendance-toggle" onClick={()=>toggleAttendance(h.id)}><strong>{h.name}</strong><span>{h.working?'● 출근 중':'○ 퇴근'}</span></button>{attendanceTeamEditing&&<button className="attendance-delete-x" type="button" aria-label={h.name+" 삭제"} onClick={()=>setAttendanceDeleteId(h.id)}>×</button>}</div>{attendanceTeamEditing?<select aria-label={h.name+' 소속'} value={attendanceTeams.some(t=>t.id===h.teamId)?h.teamId:''} disabled={attendanceTeamSaving[h.id]} onChange={e=>updateAttendanceTeam(h.id,e.target.value)}><option value="">미분류</option>{attendanceTeams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>:<span className="attendance-team-label">{attendanceTeams.find(t=>t.id===h.teamId)?.name??'미분류'}</span>}<div className="attendance-card-actions"><button className="attendance-edit" onClick={()=>{setAttendanceTc(h.id);setAttendanceTcDate(shiftDate(Date.now()))}}>T/C 조회</button><button className="attendance-edit" onClick={()=>renameAttendance(h.id)}>이름 수정</button></div></div>)}</div></main>}
    {attendanceDeleteId&&(()=>{const person=attendance.find(h=>h.id===attendanceDeleteId);return person?<div className="overlay" onClick={()=>!attendanceDeleting&&setAttendanceDeleteId(null)}><section className="modal attendance-delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="attendance-delete-title" onClick={e=>e.stopPropagation()}><div className="attendance-delete-symbol">!</div><h2 id="attendance-delete-title">출근자 삭제</h2><p>정말 <strong>'{person.name}'</strong>을(를) 삭제하시겠습니까?</p><p className="hint">출근부 목록에서 제외됩니다. 기존 T/C 및 방 기록은 보존됩니다.</p><div className="attendance-delete-actions"><button type="button" disabled={attendanceDeleting} onClick={()=>setAttendanceDeleteId(null)}>취소</button><button type="button" className="attendance-confirm-delete" disabled={attendanceDeleting} onClick={()=>void deleteAttendance(person.id)}>{attendanceDeleting?'삭제 중…':'삭제 확인'}</button></div></section></div>:null})()}
    {attendanceTc&&(()=>{const person=attendance.find(h=>h.id===attendanceTc);const all=(store.attendanceShifts??[]).filter(x=>x.tag===attendanceTc).sort((a,b)=>b.clockIn-a.clockIn);const days=[...new Set(all.flatMap(x=>shiftDays(x,now)))];const dayShifts=all.filter(x=>shiftDays(x,now).includes(attendanceTcDate));const summaries=dayShifts.map(x=>({shift:x,...dailyShiftSummary(x,store.visits,now,attendanceTcDate)}));const sum=(key:'total'|'room'|'waiting')=>summaries.reduce((v,x)=>v+x[key],0);return <div className="overlay" onClick={()=>setAttendanceTc(null)}><section className="modal tc-modal" onClick={e=>e.stopPropagation()}><div className="section"><h2>{person?.name??'출근자'} · T/C 조회</h2><button onClick={()=>setAttendanceTc(null)}>닫기</button></div><p className="hint">출근/퇴근 및 방 입실 기록 기준 · 한국시간</p><label className="tc-date-label">조회 날짜<input type="date" value={attendanceTcDate} onChange={e=>setAttendanceTcDate(e.target.value)}/></label><div className="tc-summary"><div><small>총 근무</small><strong>{timeLength(sum('total'))}</strong></div><div><small>방 근무</small><strong>{timeLength(sum('room'))}</strong></div><div><small>대기 시간</small><strong>{timeLength(sum('waiting'))}</strong></div></div><h3>출퇴근 내역</h3>{summaries.length? summaries.map(({shift})=><div className="tc-shift" key={shift.id}><span>출근 {new Date(shift.clockIn).toLocaleString('ko-KR')}</span><span>퇴근 {shift.clockOut?new Date(shift.clockOut).toLocaleString('ko-KR'):'근무 중'}</span></div>):<p className="hint">해당 날짜의 출퇴근 기록이 없습니다.</p>}<h3>근무 날짜</h3>{days.length?<div className="tc-days">{days.map(d=><button key={d} className={d===attendanceTcDate?'active':''} onClick={()=>setAttendanceTcDate(d)}>{d}</button>)}</div>:<p className="hint">기록 기능 도입 이전 출퇴근 시각은 확인할 수 없습니다. 이후 출퇴근부터 자동 기록됩니다.</p>}<p className="hint">대기 시간 = 총 근무 시간 - 방 근무 시간. 방 근무 시간은 실제 입실/퇴실 기록을 합산하며 겹친 시간은 중복 계산하지 않습니다.</p></section></div>})()}
    {attendanceAddOpen&&<div className="overlay" onClick={()=>setAttendanceAddOpen(false)}><section className="modal attendance-add-modal" onClick={e=>e.stopPropagation()}><div className="section"><h2>출근자 추가</h2><button onClick={()=>setAttendanceAddOpen(false)}>닫기</button></div><form onSubmit={e=>{e.preventDefault();const name=attendanceNewName.trim();if(!name||name.length>40){setAttendanceAddError('이름은 1~40자로 입력해 주세요.');return}if(attendance.some(h=>h.name.toLocaleLowerCase()===name.toLocaleLowerCase())){setAttendanceAddError('이미 등록된 이름입니다.');return}const teamId=attendanceTeams.some(t=>t.id===attendanceNewTeam)?attendanceNewTeam:'';setStore(v=>({...v,attendance:[...(v.attendance??[]),{id:crypto.randomUUID(),name,working:false,teamId}]}));setAttendanceAddOpen(false)}}><label>이름<input autoFocus maxLength={40} required value={attendanceNewName} onChange={e=>{setAttendanceNewName(e.target.value);setAttendanceAddError('')}} placeholder="이름 입력"/></label><label>소속<select value={attendanceNewTeam} onChange={e=>setAttendanceNewTeam(e.target.value)}><option value="">미분류</option>{attendanceTeams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>{attendanceAddError&&<p className="form-error" role="alert">{attendanceAddError}</p>}<button className="pay-submit" type="submit">출근자 등록</button></form></section></div>}
    {false&&page==='payments'&&isAdmin&&<main><h2>장부</h2><p className="hint">방 이용 시작 시각 기준 · 한국시간 17:00 ~ 다음 날 13:00 · 13:00~17:00 시작 건은 미분류</p><div className="filters"><button className={ledgerPeriod==='day'?'active':''} onClick={()=>{setLedgerPeriod('day');setPayDay('')}}>일매출</button><button className={ledgerPeriod==='month'?'active':''} onClick={()=>{setLedgerPeriod('month');setPayDay('')}}>월매출</button><input type={ledgerPeriod==='day'?'date':'month'} value={payDay?ledgerPeriod==='month'?payDay.slice(0,7):payDay:ledgerPeriod==='month'?kstDate(Date.now()).slice(0,7):operatingDay(Date.now())??kstDate(Date.now())} onChange={e=>setPayDay(e.target.value)}/></div><div className="shop-tabs"><button className={payShopTab==='all'?'active':''} onClick={()=>{setPayShopTab('all');setPayGroup('all')}}>전체 가게</button>{shops.map(sh=><button key={sh.id} className={payShopTab===sh.id?'active':''} onClick={()=>{setPayShopTab(sh.id);setPayGroup('all')}}>{sh.name}</button>)}</div><div className="filters"><select value={payGroup} onChange={e=>setPayGroup(e.target.value)}><option value="all">전체 묶음</option>{groups.filter(g=>payShopTab==='all'||g.shopId===payShopTab).map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select><select value={ledgerMethod} onChange={e=>setLedgerMethod(e.target.value as typeof ledgerMethod)}>{(['전체','현금','카드','이체','미수'] as const).map(m=><option key={m} value={m}>{m}</option>)}</select></div>
      {(()=>{const selected=payDay?ledgerPeriod==='month'?payDay.slice(0,7):payDay:ledgerPeriod==='month'?kstDate(Date.now()).slice(0,7):operatingDay(Date.now())??kstDate(Date.now());const all=(store.payments??[]).filter(p=>{const day=ledgerDay(p,store.sessions);return day!==null&&(ledgerPeriod==='day'?day===selected:day.slice(0,7)===selected)&&(payShopTab==='all'||p.shopId===payShopTab)&&(payGroup==='all'||p.groupId===payGroup)});const total=(method:Payment['method'])=>all.filter(p=>p.method===method).reduce((n,p)=>n+p.amount,0);const cash=total('현금'),card=total('카드'),transfer=total('이체'),due=total('미수');const items=all.filter(p=>ledgerMethod==='전체'||p.method===ledgerMethod);const unclassified=(store.payments??[]).filter(p=>ledgerDay(p,store.sessions)===null);return <><div className="payment-summary"><div><small>수금 합계</small><strong>{(cash+card+transfer).toLocaleString('ko-KR')}원</strong></div><div><small>미수 합계</small><strong>{due.toLocaleString('ko-KR')}원</strong></div></div><h3>결제수단별 집계</h3><div className="ledger-breakdown">{([['현금',cash],['카드',card],['이체',transfer],['미수',due]] as const).map(([name,value])=><div className="manage-row" key={name}><b>{name}</b><strong>{value.toLocaleString('ko-KR')}원</strong><small>{all.filter(p=>p.method===name).length}건</small></div>)}</div><h3>결제 내역 · {items.length}건</h3><label className="memo-filter"><input type="checkbox" checked={memoOnly} onChange={e=>setMemoOnly(e.target.checked)}/> 비고만</label>{items.filter(p=>!memoOnly||Boolean(p.memo?.trim())).map(p=><div className="payment-entry" key={p.id}><strong>{p.room} · {p.method} · {p.amount.toLocaleString('ko-KR')}원</strong><small>{shops.find(x=>x.id===p.shopId)?.name} / {groups.find(g=>g.id===p.groupId)?.name} · 결제 {date(p.at)}</small><small>귀속 영업일 {ledgerDay(p,store.sessions)}</small>{p.manager&&<small>담당: {p.manager}</small>}{p.memo&&<p>비고: {p.memo}</p>}{p.correctionNote&&<small>정정 기록: {p.correctionNote} · {p.correctedAt?date(p.correctedAt):''}</small>}<div className="buttons"><button onClick={()=>correctLedgerPayment(p.id)}>정정</button>{p.method==='미수'&&<button onClick={()=>openCollect(p.id)}>미수 전액 회수</button>}</div></div>)}{items.length===0&&<p className="hint">선택한 기간의 결제 기록이 없습니다.</p>}{unclassified.length>0&&<p className="hint">마감 후 미분류 거래 {unclassified.length}건이 있습니다. 영업일 자동 귀속에서 제외되며 추후 정정 기능이 필요합니다.</p>}</>})()}</main>}
    {page==='settings'&&isAdmin&&<main><h2>설정</h2><div className="section"><span>연결 상태: {remoteState==='ready'?'정상':'확인 필요'}</span><button onClick={()=>signOut(auth)}>로그아웃</button></div><section className="system-status-section"><button type="button" className="system-status-toggle" onClick={()=>setShowSystemDetails(v=>!v)} aria-expanded={showSystemDetails}>시스템 점검 {systemWarning?'· 확인 필요':'· 정상'} {showSystemDetails?'접기':'보기'}</button>{showSystemDetails&&<div className="system-status-detail"><p>서버 연결: {remoteState==='ready'?'정상':'확인 필요'}</p>{systemWarning?<p role="alert">{systemWarning}</p>:<p>확인된 장부 동기화 경고가 없습니다.</p>}<p className="hint">장부 기록은 자동으로 삭제하거나 덮어쓰지 않습니다.</p></div>}</section><h3>직원 승인 및 역할 관리</h3><p className="hint">직원은 로그인 화면에서 직접 가입합니다. 관리자 계정은 하나만 유지됩니다.</p>{Object.entries(staffProfiles).filter(([uid])=>uid!==ADMIN_UID).map(([uid,profile])=><div className="manage-row" key={uid}><small>{profile.name} · {profile.loginId} · {approvedStaff[uid]==='worker'||approvedStaff[uid]==='staff'?'직원':approvedStaff[uid]==='observer'?'조회 전용':'승인 대기'}</small>{!approvedStaff[uid]?<><button onClick={()=>approveStaff(uid,'worker')}>직원 승인</button><button onClick={()=>approveStaff(uid,'observer')}>조회 승인</button></>:<><label className="staff-role-select"><span className="sr-only">직원 역할</span><select aria-label="직원 역할 변경" value={approvedStaff[uid]==='observer'?'observer':'worker'} onChange={e=>changeStaffRole(uid,e.target.value as 'worker'|'observer')}><option value="worker">직원</option><option value="observer">조회 전용</option></select></label><button onClick={()=>revokeStaff(uid)}>승인 취소</button></>}</div>)}{Object.entries(approvedStaff).filter(([uid])=>uid!==ADMIN_UID&&!staffProfiles[uid]).map(([uid,v])=><div className="manage-row" key={uid}><small>기존 직원 · {uid} · {v}</small><label className="staff-role-select"><span className="sr-only">직원 역할</span><select aria-label="직원 역할 변경" value={approvedStaff[uid]==='observer'?'observer':'worker'} onChange={e=>changeStaffRole(uid,e.target.value as 'worker'|'observer')}><option value="worker">직원</option><option value="observer">조회 전용</option></select></label><button onClick={()=>revokeStaff(uid)}>승인 취소</button></div>)}<h3>결제 입력 항목</h3><label className="setting-row"><span>와리 표시</span><input type="checkbox" checked={store.showWari!==false} onChange={e=>setStore(v=>({...v,showWari:e.target.checked}))}/></label><label className="setting-row"><span>WT 표시</span><input type="checkbox" checked={store.showWt!==false} onChange={e=>setStore(v=>({...v,showWt:e.target.checked}))}/></label><h3>가게 관리</h3>{shops.map(sh=><div className="manage-row" key={sh.id}><b>{sh.name}</b><button onClick={()=>renameShop(sh.id)}>이름 변경</button></div>)}<button className="manage-add" onClick={()=>askInput('가게 추가','',value=>{const name=value.trim();if(!name)return;if(shops.some(x=>x.name.toLocaleLowerCase()===name.toLocaleLowerCase())){setRemoteError('이미 등록된 가게 이름입니다.');return}setStore(v=>({...v,shops:[...(v.shops??[]),{id:crypto.randomUUID(),name}]}))})}>+ 가게 추가</button><h3>방 묶음 관리</h3>{groups.map(g=><div className="manage-row" key={g.id}><div><b>{g.name}</b><small>{shops.find(sh=>sh.id===g.shopId)?.name}</small></div><button onClick={()=>askInput('묶음 이름 변경',g.name,value=>{const name=value.trim();if(!name)return;if(groups.some(x=>x.id!==g.id&&x.shopId===g.shopId&&x.name.toLocaleLowerCase()===name.toLocaleLowerCase())){setRemoteError('같은 가게에 이미 등록된 묶음 이름입니다.');return}setStore(v=>({...v,groups:(v.groups??[]).map(x=>x.id===g.id?{...x,name}:x)}))})}>이름</button><button onClick={()=>{if(store.rooms.some(r=>r.groupId===g.id)){setRemoteError('방이 있는 묶음은 삭제할 수 없습니다.');return}askConfirm('묶음 삭제',g.name+' 묶음을 삭제할까요?',()=>setStore(v=>({...v,groups:(v.groups??[]).filter(x=>x.id!==g.id)})))}}>삭제</button></div>)}<button className="manage-add" onClick={()=>setGroupDraft({name:'',shopId:shops[0]?.id??''})}>+ 묶음 추가</button></main>}
    {remoteError&&<div className="cloud-error" role="alert"><span>{remoteError}</span><button type="button" onClick={()=>setRemoteError('')} aria-label="알림 닫기">닫기</button></div>}
    <nav className="nav-five"><button className={page === 'rooms' ? 'on' : ''} onClick={() => setPage('rooms')}>▦<span>방 현황</span></button><button className={page === 'attendance' ? 'on' : ''} onClick={() => setPage('attendance')}>♙<span>출근부</span></button><button className={page === 'logs' ? 'on' : ''} onClick={() => setPage('logs')}>◷<span>진행 기록</span></button>{isAdmin&&<button className={page === 'settings' ? 'on' : ''} onClick={() => setPage('settings')}>⚙<span>설정</span></button>}{!isAdmin&&<button onClick={()=>signOut(auth)}>⇥<span>로그아웃</span></button>}</nav>
    {newRoomGroup&&<div className="overlay" onClick={()=>setNewRoomGroup(null)}><section className="modal" onClick={e=>e.stopPropagation()}><h2>방 추가</h2><p className="hint">{shops.find(sh=>sh.id===groups.find(g=>g.id===newRoomGroup)?.shopId)?.name} · {groups.find(g=>g.id===newRoomGroup)?.name}</p><label className="amount-label">방 이름<input autoFocus value={newRoomName} onChange={e=>{setNewRoomName(e.target.value.toUpperCase());setRoomError('')}} placeholder="예: 1T" maxLength={40}/></label>{roomError&&<p className="form-error">{roomError}</p>}<div className="buttons"><button onClick={()=>setNewRoomGroup(null)}>취소</button><button onClick={()=>{const name=newRoomName.trim().toUpperCase();const g=groups.find(x=>x.id===newRoomGroup);if(!name||!g){setRoomError('방 이름을 입력해 주세요.');return}if(duplicated(name,g.shopId)){setRoomError('같은 가게에 이미 등록된 방 이름입니다. 다른 이름을 입력해 주세요.');return}setStore(v=>({...v,rooms:[...v.rooms,{uid:crypto.randomUUID(),id:name,groupId:g.id,started:null,ends:null,tags:[]}]}));setNewRoomGroup(null);setNewRoomName('');setRoomError('')}}>방 추가 완료</button></div></section></div>}
    {page==='rooms'&&chosen.length>0&&!detail&&<div className="room-floating-selection" aria-label={chosen.length+'명 선택됨'}><button type="button" className="room-selection-clear" onClick={()=>setChosen([])}>선택 취소</button><button type="button" className="room-out-button" disabled={outBusy||!chosen.some(tag=>store.rooms.some(r=>r.tags.includes(tag)))} onClick={()=>outSelectedFromRoom(chosen)}>OUT</button></div>}
    {headcountMenu&&<div className="headcount-menu-shield" onClick={()=>setHeadcountMenu(null)}><div className="headcount-menu" role="listbox" aria-label="객수 선택" style={{position:'fixed',top:headcountMenu.top,left:headcountMenu.left,width:headcountMenu.width}} onClick={e=>e.stopPropagation()}>{Array.from({length:16},(_,i)=>i+1).map(n=><button type="button" role="option" aria-selected={store.rooms.find(r=>roomKey(r)===headcountMenu.id)?.headcount===n} key={n} className={store.rooms.find(r=>roomKey(r)===headcountMenu.id)?.headcount===n?'active':''} onClick={()=>{changeRoomHeadcount(headcountMenu.id,n);setHeadcountMenu(null)}}>{n}명</button>)}</div></div>}
    {selected && <div className="overlay" onClick={() => {setDetail(null);setChosen([])}}><section className="modal" onClick={e => e.stopPropagation()}><div className="section"><h2>{selected.id} 상세</h2><button onClick={() => {setDetail(null);setChosen([])}}>닫기</button></div><div className="large-time">{selected.ends ? format(selected.ends - now) : '대기 중'}</div><p className="hint">{selected.started ? `시작: ${date(selected.started)}` : '시작 전'}</p><div className="buttons"><button onClick={() => selected.ends ? changeTime(roomKey(selected), 60) : start(roomKey(selected))}>{selected.ends ? '+1시간' : '60분 시작'}</button><button onClick={() => { setAdjust(roomKey(selected)); setDetail(null) }}>시간 조절</button>{selected.started && <><button className="checkout-open" onClick={() => { finishRoom(roomKey(selected)) }}>마무리</button></>}{(selected.started!==null||selected.headcount||selected.tags.length>0)&&<button className="danger" onClick={()=>cancelRoom(roomKey(selected))}>진행삭제</button>}</div><h3>배치된 인원</h3><div className="room-staff-choices">{selected.tags.map(tag=><button type="button" key={tag} className={'room-staff-choice '+(chosen.includes(tag)?'selected':'')} aria-pressed={chosen.includes(tag)} onClick={()=>setChosen(prev=>prev.includes(tag)?prev.filter(x=>x!==tag):[...prev,tag])}><span>{helperName(tag)}</span><small className="room-staff-minutes">{(()=>{const visit=store.visits.filter(v=>v.tag===tag&&v.exited===null&&sameRoom(v,roomKey(selected))).sort((a,b)=>b.entered-a.entered)[0];return visit?Math.max(0,Math.floor((now-visit.entered)/60000))+'분':'--분'})()}</small></button>)}</div>{!selected.tags.length&&<p className="hint">배치 인원 없음</p>}{chosen.length>0&&<div className="room-out-area"><div className="room-selection-actions"><button type="button" className="room-selection-clear" onClick={()=>setChosen([])}>선택 취소</button><button type="button" className="room-out-button" disabled={outBusy||!chosen.some(tag=>store.rooms.some(r=>r.tags.includes(tag)))} onClick={()=>outSelectedFromRoom(chosen)}>OUT</button></div><small>{chosen.length}명 선택 · 상세창을 닫고 이동할 방을 누르세요</small></div>}</section></div>}
    {false&&!!collectId&&isAdmin&&<div className="overlay" onClick={()=>setCollectId(null)}><section className="modal" onClick={e=>e.stopPropagation()}><div className="section"><h2>미수금 전액 회수</h2><button onClick={()=>setCollectId(null)}>닫기</button></div><p className="hint">{(()=>{const p=store.payments.find(x=>x.id===collectId);return p ? `${p.room} · ${p.amount.toLocaleString('ko-KR')}원` : '결제 내역 확인 중'})()}</p><h3>회수 수단 선택</h3><div className="pay-methods">{(['현금','카드','이체'] as const).map(m=><button type="button" key={m} className={collectMethod===m?'active':''} onClick={()=>setCollectMethod(m)}>{m}</button>)}</div><label className="amount-label">회수 비고 (선택)<textarea rows={2} maxLength={500} value={collectNote} onChange={e=>setCollectNote(e.target.value)} placeholder="예: 계좌 입금 확인"/></label><button className="pay-submit" disabled={!collectMethod} onClick={()=>collectUnpaid()}>선택한 수단으로 전액 회수</button></section></div>}
    {false&&!!checkout && <div className="overlay" onClick={() => setCheckout(null)}><section className="modal" onClick={e => e.stopPropagation()}><div className="section"><h2>{roomName(checkout??'')} · 마무리(결제)</h2><button onClick={() => setCheckout(null)}>취소</button></div><p className="hint">결제 수단을 선택하고 금액을 입력한 후 완료하세요. 미수는 실제 수금이 아닌 미수 기록으로 저장됩니다.</p><div className="pay-methods">{(['카드','현금','이체','미수'] as const).map(m => <button key={m} className={payMethod === m ? 'active' : ''} onClick={() => setPayMethod(m)}>{m}</button>)}</div><label className="amount-label">{payMethod === '미수' ? '미수 금액' : '결제금액'} (원)<input inputMode="numeric" type="text" pattern="[0-9]*" placeholder="예: 150000" value={payAmount} onChange={e => setPayAmount(e.target.value.replace(/[^0-9]/g,''))}/></label><label className="amount-label checkout-extra">담당<input type="text" maxLength={80} placeholder="담당자 이름 입력" value={payManager} onChange={e => setPayManager(e.target.value)}/></label>{store.showWari!==false&&<label className="amount-label checkout-extra">와리<input type="text" value={payWari} onChange={e=>setPayWari(e.target.value)} placeholder="와리 입력"/></label>}{store.showWt!==false&&<label className="amount-label checkout-extra">WT<input type="text" value={payWt} onChange={e=>setPayWt(e.target.value)} placeholder="WT 입력"/></label>}<label className="amount-label checkout-extra">비고 (메모)<textarea rows={3} maxLength={1000} placeholder="결제 관련 메모 입력" value={payMemo} onChange={e => setPayMemo(e.target.value)}/></label><button className="pay-submit" disabled={checkoutSaving || !payMethod || !payAmount || Number(payAmount) <= 0} onClick={saveCheckout}>{checkoutSaving?'결제 저장 중...':'완료 · 기록 저장 및 방 마무리'}</button></section></div>}
    {notice&&<div className="cloud-error" role="alert"><span>{notice}</span><button type="button" onClick={()=>setNotice('')}>닫기</button></div>}
    {groupDraft&&<div className="overlay" onClick={()=>setGroupDraft(null)}><section className="modal app-dialog" role="dialog" aria-modal="true" onClick={e=>e.stopPropagation()}><h2>묶음 추가</h2><label className="amount-label">묶음 이름<input autoFocus maxLength={40} value={groupDraft.name} onChange={e=>setGroupDraft(v=>v?{...v,name:e.target.value}:null)}/></label><label className="amount-label">소속 가게<select value={groupDraft.shopId} onChange={e=>setGroupDraft(v=>v?{...v,shopId:e.target.value}:null)}>{shops.map(sh=><option key={sh.id} value={sh.id}>{sh.name}</option>)}</select></label><div className="app-dialog-actions"><button type="button" onClick={()=>setGroupDraft(null)}>취소</button><button type="button" className="app-dialog-accept" disabled={!groupDraft.name.trim()||!groupDraft.shopId} onClick={()=>{const name=groupDraft.name.trim(),shopId=groupDraft.shopId;if(groups.some(g=>g.shopId===shopId&&g.name.toLocaleLowerCase()===name.toLocaleLowerCase())){notify('같은 가게에 이미 등록된 묶음 이름입니다.');return}setStore(v=>({...v,groups:[...(v.groups??[]),{id:crypto.randomUUID(),shopId,name,layout:[]}]}));setGroupDraft(null)}}>추가</button></div></section></div>}
    {false&&!!ledgerEdit&&<div className="overlay" onClick={()=>setLedgerEdit(null)}><section className="modal app-dialog" role="dialog" aria-modal="true" onClick={e=>e.stopPropagation()}><h2>장부 정정</h2><label className="amount-label">정정 금액 (원)<input inputMode="numeric" value={ledgerEdit?.amount??''} onChange={e=>setLedgerEdit(v=>v?{...v,amount:e.target.value.replace(/[^0-9]/g,'')}:null)}/></label><label className="amount-label">결제수단<select value={ledgerEdit?.method??'현금'} onChange={e=>setLedgerEdit(v=>v?{...v,method:e.target.value as Payment['method']}:null)}>{(['현금','카드','이체','미수'] as const).map(m=><option key={m} value={m}>{m}</option>)}</select></label><label className="amount-label">정정 사유 (필수)<textarea rows={3} maxLength={500} value={ledgerEdit?.note??''} onChange={e=>setLedgerEdit(v=>v?{...v,note:e.target.value}:null)}/></label><div className="app-dialog-actions"><button type="button" onClick={()=>setLedgerEdit(null)}>취소</button><button type="button" className="app-dialog-accept" disabled={!ledgerEdit?.note?.trim()||!ledgerEdit?.amount} onClick={saveLedgerCorrection}>정정 저장</button></div></section></div>}
    {uiDialog&&<div className="overlay app-dialog-overlay" onClick={()=>setUiDialog(null)}><section className="modal app-dialog" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title" onClick={e=>e.stopPropagation()}><h2 id="app-dialog-title">{uiDialog.title}</h2>{uiDialog.message&&<p>{uiDialog.message}</p>}{uiDialog.kind==='input'&&<input autoFocus aria-label={uiDialog.title} maxLength={80} value={uiDialog.value} onChange={e=>setUiDialog(v=>v?{...v,value:e.target.value}:null)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();acceptDialog()}}}/>}<div className="app-dialog-actions"><button type="button" onClick={()=>setUiDialog(null)}>취소</button><button type="button" className={uiDialog.danger?'app-dialog-danger':'app-dialog-accept'} disabled={uiDialog.kind==='input'&&!uiDialog.value.trim()} onClick={acceptDialog}>{uiDialog.kind==='input'?'저장':'확인'}</button></div></section></div>}
    {adjust && <div className="overlay" onClick={() => setAdjust(null)}><section className="modal" onClick={e => e.stopPropagation()}><div className="section"><h2>{roomName(adjust)} 시간 조절</h2><button onClick={() => setAdjust(null)}>닫기</button></div><p className="hint">남은 시간을 분 단위로 직접 입력하세요. 34 입력 시 34분 00초로 설정됩니다.</p><form className="direct-time-form" onSubmit={e=>{e.preventDefault();setRemainingMinutes(adjust,directMinutes)}}><label htmlFor="direct-minutes">남은 시간 (분)</label><input id="direct-minutes" type="number" inputMode="numeric" min="1" max="99999" step="1" placeholder="예: 34" value={directMinutes} onChange={e=>setDirectMinutes(e.target.value)} required/><button type="submit">직접 입력 · 시간 적용</button></form><div className="quick-time-grid">{[1,5,10,30,60].map(n=><button type="button" key={'plus'+n} className="quick-time-plus" onClick={()=>changeTime(adjust,n)}>+{n===60?'1시간':n+'분'}</button>)}{[1,5,10,30,60].map(n=><button type="button" key={'minus'+n} className="quick-time-minus" onClick={()=>changeTime(adjust,-n)}>−{n===60?'1시간':n+'분'}</button>)}</div></section></div>}
    {viewSession && <div className="overlay" onClick={() => setViewSession(null)}><section className="modal" onClick={e => e.stopPropagation()}><div className="section"><h2>이용 회차 상세</h2><button onClick={() => setViewSession(null)}>닫기</button></div>{(() => { const x = store.sessions.find(s => s.id === viewSession); if (!x) return null; const next = store.sessions.filter(s => (x.roomUid ? s.roomUid === x.roomUid : s.room === x.room) && s.started > x.started).sort((a,b) => a.started-b.started)[0]; const end = x.ended ?? next?.started ?? now; return <><p>{x.room} · 시작 {date(x.started)}</p><p>종료 {x.ended ? date(x.ended) : '진행 중'} · 경과 {Math.floor((end-x.started)/60000)}분</p><h3>태그 입퇴실</h3>{store.visits.filter(v => (x.roomUid ? v.roomUid === x.roomUid : v.room === x.room) && v.entered >= x.started && v.entered <= end).map(v => <p className="visit" key={v.id}>{helperName(v.tag)} · 입실 {date(v.entered)} · 퇴실 {v.exited ? date(v.exited) : '이용 중'}</p>)}<h3>조작 기록</h3>{store.logs.filter(l => (x.roomUid ? l.roomUid === x.roomUid : l.room === x.room) && l.at >= x.started && l.at <= end).map(l => <p className="visit" key={l.id}>{date(l.at)} · {l.action}</p>)}</> })()}</section></div>}
  </div>
}
