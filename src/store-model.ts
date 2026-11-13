export type ObserverRoom={uid:string;name:string;shop:string;group:string;started:number|null;ends:number|null;headcount:number}
export type ObserverSnapshot={rooms:ObserverRoom[];updatedAt:number}
export type Attendance={id:string;name:string;working:boolean;teamId?:string;archivedAt?:number}
export type AttendanceShift={id:string;tag:string;clockIn:number;clockOut:number|null}
export type AttendanceTeam={id:string;name:string}
export type Shop = { id: string; name: string }
export type Group = { id: string; shopId: string; name: string; layout: (string | null)[] }
export type Room = { id: string; uid?: string; groupId?: string; started: number | null; ends: number | null; tags: string[]; headcount?:number; cleaning?:boolean; memo?:string }
export type Log = { id: string; at: number; room: string; roomUid?: string; action: string }
export type Visit = { id: string; tag: string; room: string; roomUid?: string; entered: number; exited: number | null }
export type Session = { id: string; room: string; roomUid?: string; started: number; ended: number | null }
export type Payment = { id: string; room: string; roomUid?: string; at: number; amount: number; method: '카드' | '현금' | '이체' | '미수'; sessionId: string | null; startedAt?:number; correctedAt?:number; correctionNote?:string; manager?: string; memo?: string; shopId?: string; groupId?: string; wari?: string; wt?: string }
export type Store = { rooms: Room[]; tags: string[]; attendance?:Attendance[]; attendanceTeams?:AttendanceTeam[]; attendanceShifts?:AttendanceShift[]; logs: Log[]; visits: Visit[]; sessions: Session[]; payments: Payment[]; layout?: (string | null)[]; shops?: Shop[]; groups?: Group[]; showWari?: boolean; showWt?: boolean }
export const seed: Store = { rooms: Array.from({ length: 6 }, (_, i) => ({ id: `${i + 1}T`, started: null, ends: null, tags: [] })), tags: ['A01', 'A02', 'A03', 'A04', 'A05', 'A06'], logs: [], visits: [], sessions: [], payments: [], layout: [], shops: [{ id: 'shop-a', name: '가게 A' }, { id: 'shop-b', name: '가게 B' }], groups: [{ id: 'group-default', shopId: 'shop-a', name: '기본 묶음', layout: [] }], showWari: true, showWt: true }
export function read(): Store {
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
    return {...seed,...old,rooms:mappedRooms,shops,groups:migrated,payments,logs:enrich(old.logs??[]),visits:mappedVisits,sessions:enrich(old.sessions??[]),attendance,attendanceTeams:old.attendanceTeams??[]}

  } catch { return seed }
}
// Realtime Database omits empty arrays and null-only fields; restore the UI's array contract.
export function normalizeRemote(raw: Store): Store {
  const array = <T,>(value:unknown):T[] =>
    Array.isArray(value) ? value as T[] :
    value && typeof value==='object' ? Object.values(value) as T[] : []
  const rooms=array<Room>(raw.rooms).map(r=>({...r,tags:array<string>(r.tags),started:r.started??null,ends:r.ends??null}))
  const groups=array<Group>(raw.groups).map(g=>({...g,layout:Array.isArray(g.layout)?g.layout:[]}))
  return {...seed,...raw,rooms,tags:array<string>(raw.tags),attendance:array<Attendance>(raw.attendance),attendanceTeams:array<AttendanceTeam>(raw.attendanceTeams),attendanceShifts:array<AttendanceShift>(raw.attendanceShifts),logs:array<Log>(raw.logs),visits:array<Visit>(raw.visits),sessions:array<Session>(raw.sessions),payments:array<Payment>(raw.payments),shops:array<Shop>(raw.shops),groups}
}
export const format = (ms: number) => { const n = Math.max(0, Math.ceil(ms / 1000)); return [Math.floor(n / 3600), Math.floor(n % 3600 / 60), n % 60].map(x => String(x).padStart(2, '0')).join(':') }
// KST operating day: 17:00 inclusive through next-day 13:00 exclusive.
export function kstDate(ms:number):string {return new Date(ms+9*3600000).toISOString().slice(0,10)}
export function operatingDay(ms:number):string|null {
  const kst=new Date(ms+9*3600000)
  const hour=kst.getUTCHours()
  if(hour>=13&&hour<17)return null
  return kstDate(ms-(hour<13?86400000:0))
}
export function ledgerDay(payment:Payment,sessions:Session[]):string|null {
  const session=payment.sessionId?sessions.find(s=>s.id===payment.sessionId):undefined
  return operatingDay(payment.startedAt??session?.started??payment.at)
}
export const date = (n: number) => new Date(n).toLocaleString('ko-KR', { hour12: false })
