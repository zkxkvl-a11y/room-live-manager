import type { RoomHistory, Store } from '../store-model'

/** Capture immutable run details before room state and memo are cleared. */
export function captureRoomHistory(store:Store,roomUid:string,ended:number,outcome:RoomHistory['outcome']):RoomHistory|undefined {
  const room=store.rooms.find(r=>(r.uid??r.id)===roomUid)
  if(!room)return
  const same=(v:{room:string;roomUid?:string})=>v.roomUid?v.roomUid===roomUid:v.room===room.id
  const sessions=store.sessions.filter(s=>same(s)&&s.ended===null)
  const active=sessions.sort((a,b)=>b.started-a.started)[0]
  const started=active?.started??room.started??null
  const group=store.groups?.find(g=>g.id===room.groupId)
  const shop=store.shops?.find(s=>s.id===group?.shopId)
  const visits=store.visits.filter(v=>same(v)&&v.entered<=ended&&(started===null||v.exited===null||v.exited>=started))
  const staff=visits.map(v=>({tag:v.tag,name:store.attendance?.find(a=>a.id===v.tag)?.name??v.tag,entered:v.entered,exited:v.exited??ended})).sort((a,b)=>a.entered-b.entered)
  const events=store.logs.filter(l=>same(l)&&l.at<=ended&&(started===null||l.at>=started)).map(l=>({at:l.at,action:l.action})).sort((a,b)=>a.at-b.at)
  return {id:active?.id??crypto.randomUUID(),room:room.id,roomUid,shop:shop?.name??'가게',group:group?.name??'기본 묶음',started,ended,outcome,memo:room.memo??'',staff,events}
}
