const {onValueCreated,onValueWritten}=require('firebase-functions/v2/database')
const {initializeApp,getApps}=require('firebase-admin/app')
const {getDatabase}=require('firebase-admin/database')
if(!getApps().length)initializeApp()
const BASE='roomLiveV2'
const ADMIN='P4ksHlEQiqNhQRRHKdPRAaE8Srb2'
const roleAllowed=(role)=>role==='worker'||role==='staff'
const array=(v)=>Array.isArray(v)?v:v&&typeof v==='object'?Object.values(v):[]
const roomKey=(r)=>r.uid||r.id
const sameRoom=(r,room)=>r.roomUid? r.roomUid===roomKey(room):r.room===room.id
const clean=(s)=>s.replace(/[.#$\[\]/]/g,'_')

exports.processCheckout=onValueCreated({ref:BASE+'/checkoutRequests/{requestId}',region:'asia-southeast1',instance:'room-live-manager-default-rtdb'},async(event)=>{
  const id=event.params.requestId
  const request=event.data.val()
  const db=getDatabase()
  const uid=request?.uid
  if(!uid||request.id!==id)return
  const [roleSnap]=await Promise.all([db.ref('roomLiveAccess/'+clean(uid)).get()])
  if(uid!==ADMIN&&!roleAllowed(roleSnap.val())){
    await db.ref(BASE+'/checkoutRequests/'+id+'/status').set('rejected')
    return
  }
  const root=db.ref(BASE)
  const result=await root.transaction(current=>{
    if(!current||!current.operations||!current.finance||!current.checkoutRequests?.[id])return
    const req=current.checkoutRequests[id]
    if(req.status==='completed'||req.status==='rejected')return
    const ops=current.operations,finance=current.finance
    const rooms=array(ops.rooms),sessions=array(ops.sessions),visits=array(ops.visits),payments=array(finance.payments)
    const room=rooms.find(r=>roomKey(r)===req.roomUid)
    const active=sessions.filter(s=>room&&sameRoom(s,room)&&s.ended==null)
    const valid=room&&room.started!=null&&active.length<=1&&(!active.length||active[0].started===room.started)
      &&Number.isSafeInteger(req.amount)&&req.amount>0&&req.amount<=1000000000
      &&['카드','현금','이체','미수'].includes(req.method)
      &&!payments.some(p=>p.id===id)
    if(!valid){
      req.status='rejected'
      return current
    }
    const at=Date.now()
    const payment={id,room:room.id,roomUid:req.roomUid,at,startedAt:room.started,amount:req.amount,method:req.method,
      sessionId:active[0]?.id??null,manager:req.manager||'',memo:req.memo||'',wari:req.wari||'',wt:req.wt||'',
      groupId:room.groupId||null,shopId:array(ops.groups).find(g=>g.id===room.groupId)?.shopId||null}
    finance.payments=[payment,...payments]
    ops.sessions=sessions.map(s=>sameRoom(s,room)&&s.ended==null?{...s,ended:at}:s)
    ops.visits=visits.map(v=>sameRoom(v,room)&&v.exited==null?{...v,exited:at}:v)
    ops.rooms=rooms.map(r=>roomKey(r)===req.roomUid?{...r,started:null,ends:null,tags:[]}:r)
    ops.logs=[{id:id+'-checkout',at,room:room.id,roomUid:req.roomUid,action:'방 마감 완료'},...array(ops.logs)]
    req.status='completed'
    req.completedAt=at
    return current
  },undefined,false)
  if(!result.committed){
    const status=(await db.ref(BASE+'/checkoutRequests/'+id+'/status').get()).val()
    if(!status)await db.ref(BASE+'/checkoutRequests/'+id+'/status').set('rejected')
  }
})
exports.publishObserver=onValueWritten({ref:BASE+'/operations',region:'asia-southeast1',instance:'room-live-manager-default-rtdb'},async(event)=>{
  const ops=event.data.after.val()
  if(!ops)return
  const shops=array(ops.shops),groups=array(ops.groups)
  const rooms=array(ops.rooms).map(r=>{
    const group=groups.find(g=>g.id===r.groupId)
    return {uid:roomKey(r),name:r.id,shop:shops.find(s=>s.id===group?.shopId)?.name||'',group:group?.name||'',
      started:r.started??null,ends:r.ends??null,headcount:array(r.tags).length}
  })
  await getDatabase().ref('roomLiveObserver').set({rooms,updatedAt:Date.now()})
})
