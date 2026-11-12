import type { Log, Payment, Store } from '../store-model'

export type CheckoutRequest = {
  paymentId:string
  roomUid:string
  method:Payment['method']
  amount:number
  at:number
  manager:string
  memo:string
  wari:string
  wt:string
}

// Pure and retry-safe: RTDB can invoke transaction updaters multiple times.
export function applyCheckout(previous:Store,request:CheckoutRequest):Store|undefined {
  const {paymentId,roomUid,method,amount,at,manager,memo,wari,wt}=request
  if(!Number.isSafeInteger(amount)||amount<=0||amount>1000000000)return
  if(!['현금','카드','이체','미수'].includes(method))return
  if(previous.payments.some(p=>p.id===paymentId))return
  const sameRoom=(x:{room:string;roomUid?:string})=>
    x.roomUid===roomUid||(!x.roomUid&&previous.rooms.some(r=>(r.uid??r.id)===roomUid&&r.id===x.room))
  const active=previous.rooms.find(r=>(r.uid??r.id)===roomUid)
  if(!active||active.started===null)return
  const openSessions=previous.sessions.filter(s=>sameRoom(s)&&s.ended===null)
  if(openSessions.length>1||(openSessions.length===1&&openSessions[0].started!==active.started))return
  const session=openSessions[0]
  const payment:Payment={
    id:paymentId,room:active.id,roomUid,at,startedAt:active.started,amount,method,
    sessionId:session?.id??null,manager,memo,wari,wt,groupId:active.groupId,
    shopId:previous.groups?.find(g=>g.id===active.groupId)?.shopId
  }
  const logs:Log[]=[
    {id:paymentId+'-checkout',at,room:active.id,roomUid,action:'마무리(결제) · '+method+' · '+amount.toLocaleString('ko-KR')+'원'},
    ...active.tags.map((tag,index)=>({id:paymentId+'-exit-'+index,at,room:active.id,roomUid,action:tag+' 퇴실 · 결제 완료'}))
  ]
  return {...previous,
    payments:[payment,...previous.payments],
    sessions:previous.sessions.map(s=>sameRoom(s)&&s.ended===null?{...s,ended:at}:s),
    visits:previous.visits.map(v=>sameRoom(v)&&v.exited===null?{...v,exited:at}:v),
    rooms:previous.rooms.map(r=>(r.uid??r.id)===roomUid?{...r,started:null,ends:null,tags:[],headcount:0}:r),
    logs:[...logs,...previous.logs]
  }
}
