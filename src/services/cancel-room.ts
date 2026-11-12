import type { Log, Store } from '../store-model'

// Retry-safe, idempotent room cancellation. No payment is created.
export function applyCancelRoom(previous:Store, roomUid:string, at:number, logId:string):Store|undefined {
  const room=previous.rooms.find(r=>(r.uid??r.id)===roomUid)
  if(!room)return
  // A headcount-only room has no running timer, but must still be cancellable.
  // Completely vacant rooms have nothing to cancel.
  if(room.started===null&&room.ends===null&&room.tags.length===0&&!room.headcount)return
  const sameRoom=(x:{room:string;roomUid?:string})=>
    x.roomUid===roomUid||(!x.roomUid&&x.room===room.id)
  // Legacy data can contain stale or duplicate open sessions after time edits.\n  // Cancellation must close all matching sessions rather than abort the transaction.
  const logs:Log[]=[
    {id:logId,at,room:room.id,roomUid,action:'진행삭제 · 결제 없이 종료'},
    ...room.tags.map((tag,i)=>({id:logId+'-exit-'+i,at,room:room.id,roomUid,action:tag+' 퇴실 · 진행삭제'}))
  ]
  return {...previous,
    rooms:previous.rooms.map(r=>(r.uid??r.id)===roomUid?{...r,started:null,ends:null,tags:[],headcount:undefined}:r),
    sessions:previous.sessions.map(s=>sameRoom(s)&&s.ended===null?{...s,ended:at}:s),
    visits:previous.visits.map(v=>sameRoom(v)&&v.exited===null?{...v,exited:at}:v),
    logs:[...logs,...previous.logs]
  }
}
