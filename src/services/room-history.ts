import type { RoomHistory, Store } from '../store-model'

/** Snapshot only the current room run, never earlier runs from the same room. */
export function captureRoomHistory(store:Store,roomUid:string,ended:number,outcome:RoomHistory['outcome']):RoomHistory|undefined {
  const room=store.rooms.find(r=>(r.uid??r.id)===roomUid)
  if(!room)return
  const same=(v:{room:string;roomUid?:string})=>v.roomUid?v.roomUid===roomUid:v.room===room.id
  const active=store.sessions.filter(s=>same(s)&&s.ended===null).sort((a,b)=>b.started-a.started)[0]
  const allLogs=store.logs.filter(l=>same(l)&&l.at<=ended).sort((a,b)=>a.at-b.at)
  // A previous finish/cancellation is a hard boundary even if legacy sessions were left open.
  const previousEnd=allLogs.filter(l=>/진행삭제|결제 없이 종료|마무리/.test(l.action)&&!(/퇴실|OUT/.test(l.action))).at(-1)?.at??0
  const runLogs=allLogs.filter(l=>l.at>previousEnd)
  const firstActivity=runLogs.find(l=>/인원수 .*명 설정|입실|자동 시작|60분 시작|시작/.test(l.action))?.at
  const candidates=[room.runStartedAt,active?.started,room.started,firstActivity].filter((v):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>previousEnd&&v<=ended)
  // Legacy records without an explicit start must never inherit events from earlier runs.
  const started=candidates.length?Math.min(...candidates):null
  const group=store.groups?.find(g=>g.id===room.groupId)
  const shop=store.shops?.find(s=>s.id===group?.shopId)
  const visits=started===null?[]:store.visits.filter(v=>same(v)&&v.entered>=started&&v.entered<=ended)
  const staff=visits.map(v=>({tag:v.tag,name:store.attendance?.find(a=>a.id===v.tag)?.name??v.tag,entered:v.entered,exited:v.exited??ended})).sort((a,b)=>a.entered-b.entered)
  const events=started===null?[]:runLogs.filter(l=>l.at>=started).map(l=>({at:l.at,action:l.action.replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi,'직원')})).sort((a,b)=>a.at-b.at)
  return {id:crypto.randomUUID(),room:room.id,roomUid,shop:shop?.name??'가게',group:group?.name??'기본 묶음',started,ended,outcome,memo:room.memo??'',staff,events}
}
