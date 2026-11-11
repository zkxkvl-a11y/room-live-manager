import { useEffect, useRef, useState } from 'react'
import './App.css'

type Shop = { id: string; name: string }
type Group = { id: string; shopId: string; name: string; layout: (string | null)[] }
type Room = { id: string; uid?: string; groupId?: string; started: number | null; ends: number | null; tags: string[] }
type Log = { id: string; at: number; room: string; roomUid?: string; action: string }
type Visit = { id: string; tag: string; room: string; roomUid?: string; entered: number; exited: number | null }
type Session = { id: string; room: string; roomUid?: string; started: number; ended: number | null }
type Payment = { id: string; room: string; roomUid?: string; at: number; amount: number; method: '카드' | '현금' | '이체' | '미수'; sessionId: string | null; manager?: string; memo?: string; shopId?: string; groupId?: string; wari?: string; wt?: string }
type Store = { rooms: Room[]; tags: string[]; logs: Log[]; visits: Visit[]; sessions: Session[]; payments: Payment[]; layout?: (string | null)[]; shops?: Shop[]; groups?: Group[]; showWari?: boolean; showWt?: boolean }
const seed: Store = { rooms: Array.from({ length: 6 }, (_, i) => ({ id: `${i + 1}T`, started: null, ends: null, tags: [] })), tags: ['A01', 'A02', 'A03', 'A04', 'A05', 'A06'], logs: [], visits: [], sessions: [], payments: [], layout: [], shops: [{ id: 'shop-a', name: '가게 A' }, { id: 'shop-b', name: '가게 B' }], groups: [{ id: 'group-default', shopId: 'shop-a', name: '기본 묶음', layout: [] }], showWari: true, showWt: true }
function read(): Store {
  try {
    const raw = localStorage.getItem('room-live-v1')
    if (!raw) return {...seed,rooms:seed.rooms.map(r=>({...r,uid:crypto.randomUUID(),groupId:'group-default'}))}
    const old = JSON.parse(raw) as Store
    const shops = old.shops?.length ? old.shops : seed.shops!
    const groups = old.groups?.length ? old.groups : seed.groups!
    const rooms = (old.rooms ?? seed.rooms).map(r => ({ ...r, uid: r.uid ?? crypto.randomUUID(), groupId: r.groupId ?? groups[0].id }))
    const byName = (name:string) => rooms.find(r=>r.id===name)
    const layout = old.layout?.length ? old.layout : rooms.map(r=>r.id)
    const migrated = groups.map((g,i)=>({...g,layout:(g.layout?.length ? g.layout : i===0 ? layout : []).map(key=>key===null?null:rooms.find(r=>r.uid===key&&r.groupId===g.id)?.uid??rooms.find(r=>r.id===key&&r.groupId===g.id)?.uid??null)}))
    const enrich = <T extends {room:string;roomUid?:string}>(items:T[])=>items.map(x=>({...x,roomUid:x.roomUid??byName(x.room)?.uid}))
    const payments = (old.payments??[]).map(p=>({...p,roomUid:p.roomUid??byName(p.room)?.uid,groupId:p.groupId??byName(p.room)?.groupId??groups[0].id,shopId:p.shopId??groups.find(g=>g.id===(byName(p.room)?.groupId??groups[0].id))?.shopId??shops[0].id}))
    return {...seed,...old,rooms,shops,groups:migrated,payments,logs:enrich(old.logs??[]),visits:enrich(old.visits??[]),sessions:enrich(old.sessions??[])}

  } catch { return seed }
}
const format = (ms: number) => { const n = Math.max(0, Math.ceil(ms / 1000)); return [Math.floor(n / 3600), Math.floor(n % 3600 / 60), n % 60].map(x => String(x).padStart(2, '0')).join(':') }
const date = (n: number) => new Date(n).toLocaleString('ko-KR', { hour12: false })
export default function App() {
  const [store, setStore] = useState<Store>(read)
  const [now, setNow] = useState(Date.now())
  const [page, setPage] = useState<'rooms' | 'logs' | 'payments' | 'settings'>('rooms')
  const [detail, setDetail] = useState<string | null>(null)
  const [adjust, setAdjust] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
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
  useEffect(() => { localStorage.setItem('room-live-v1', JSON.stringify(store)) }, [store])
  const roomKey=(r:Room)=>r.uid??r.id
  const roomName=(uid:string)=>store.rooms.find(r=>roomKey(r)===uid)?.id??uid
  const record = (uid: string, action: string): Log => ({ id: crypto.randomUUID(), at: Date.now(), room:roomName(uid), roomUid:uid, action })
  const sameRoom=(x:{room:string;roomUid?:string},uid:string)=>x.roomUid?x.roomUid===uid:x.room===roomName(uid)
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
    setStore(v => ({ ...v, payments: [payment, ...(v.payments ?? [])], sessions: v.sessions.map(x => sameRoom(x,checkout) && x.ended === null ? { ...x, ended: at } : x), visits: v.visits.map(x => sameRoom(x,checkout) && x.exited === null ? { ...x, exited: at } : x), rooms: v.rooms.map(x => roomKey(x) === checkout ? { ...x, started: null, ends: null, tags: [] } : x), logs: [record(checkout, `마무리(결제) · ${payMethod} · ${amount.toLocaleString('ko-KR')}원`), ...r.tags.map(tag => record(checkout, `${tag} 퇴실 · 결제 완료`)), ...v.logs] }))
    setCheckout(null); setDetail(null); setPayMethod(null); setPayAmount(''); setPayManager(''); setPayMemo('')
  }
  function place(tag: string, destination: string | null) {
    setStore(s => {
      const origin = s.rooms.find(r => r.tags.includes(tag))
      if (origin && roomKey(origin) === destination) return s
      const at = Date.now()
      const logs = [...(origin ? [record(roomKey(origin), `${tag} 퇴실`)] : []), ...(destination ? [record(destination, `${tag} 입실`)] : [])]
      return { ...s, rooms: s.rooms.map(r => ({ ...r, tags: roomKey(r) === destination ? [...r.tags.filter(t => t !== tag), tag] : r.tags.filter(t => t !== tag) })), logs: [...logs, ...s.logs], visits: [...(destination ? [{ id: crypto.randomUUID(), tag, room:roomName(destination!),roomUid:destination!, entered: at, exited: null }] : []), ...s.visits.map(v => v.tag === tag && v.exited === null ? { ...v, exited: at } : v)] }
    })
    setChosen(null)
  }
  function roomTap(id: string) {
    if (held.current) { held.current = false; return }
    if (editing) return
    if (chosen) { place(chosen, id); return }
    const t = Date.now()
    if (tap.current?.room === id && t - tap.current.time < 350) { tap.current = null; changeTime(id, 60) }
    else { tap.current = { room: id, time: t }; setTimeout(() => { if (tap.current?.room === id && tap.current.time === t) { tap.current = null; setDetail(id) } }, 360) }
  }
  const selected = store.rooms.find(r => roomKey(r) === detail)
  return <div className="app">
    <header><div><span className="kicker">ROOM LIVE · v0.4.1</span><h1>룸 라이브</h1><p>방 · 태그 · 시간 통합 관리</p></div><span className="status">● 로컬 테스트</span></header>
    {page === 'rooms' && <main>
      <div className="section"><h2>방 현황 <small>{store.rooms.length}개</small></h2><button onClick={() => { setEditing(!editing); setMoving(null); setChosen(null) }}>{editing ? '편집 완료' : '배치 편집'}</button></div>
      <div className="shop-tabs"><button className={shopTab==='all'?'active':''} onClick={()=>setShopTab('all')}>전체</button>{shops.map(sh=><button key={sh.id} className={shopTab===sh.id?'active':''} onClick={()=>setShopTab(sh.id)}>{sh.name}</button>)}</div>
      {shops.filter(sh=>shopTab==='all'||sh.id===shopTab).map(sh=><div className="shop-section" key={sh.id}><div className="shop-divider"><span>{sh.name}</span></div>{groups.filter(g=>g.shopId===sh.id).map(g=>{
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
              onPointerDown={e=>{touchStart.current={x:e.clientX,y:e.clientY};held.current=false;if(!editing&&!chosen)hold.current=setTimeout(()=>{held.current=true;setDetail(null);setAdjust(roomKey(r))},550)}}
              onPointerMove={e=>{if(touchStart.current&&Math.hypot(e.clientX-touchStart.current.x,e.clientY-touchStart.current.y)>12&&hold.current)clearTimeout(hold.current)}}
              onPointerUp={()=>{if(hold.current)clearTimeout(hold.current)}} onPointerLeave={()=>{if(hold.current)clearTimeout(hold.current)}} onPointerCancel={()=>{if(hold.current)clearTimeout(hold.current)}}
              onContextMenu={e=>{e.preventDefault();if(!editing&&!chosen){held.current=true;setAdjust(roomKey(r))}}}>
              <div className="room-head"><strong>{r.id}</strong><span>{expired?'시간 종료':r.ends?'이용 중':'대기'}</span></div>
              <div className="time">{r.ends?format(r.ends-now):'--:--:--'}</div>
              <div className="tags">{r.tags.length?r.tags.join(' · '):'태그 없음'}</div>
              {editing&&<div className="room-tools"><button onClick={e=>{e.stopPropagation();let name=prompt('방 이름',r.id)?.trim().toUpperCase();while(name&&name!==r.id){if(duplicated(name,g.shopId,roomKey(r))){alert('같은 가게에 이미 등록된 방 이름입니다. 다시 입력해 주세요.');name=prompt('다른 방 이름 입력',name)?.trim().toUpperCase();continue}setStore(v=>({...v,rooms:v.rooms.map(x=>roomKey(x)===roomKey(r)?{...x,id:name}:x),logs:v.logs.map(x=>sameRoom(x,roomKey(r))?{...x,room:name}:x),visits:v.visits.map(x=>sameRoom(x,roomKey(r))?{...x,room:name}:x),sessions:v.sessions.map(x=>sameRoom(x,roomKey(r))?{...x,room:name}:x),payments:v.payments.map(x=>sameRoom(x,roomKey(r))?{...x,room:name}:x)}));break}}}>이름</button><button onClick={e=>{e.stopPropagation();if(r.started||r.tags.length){alert('진행 중인 방은 이동할 수 없습니다.');return}const dest=prompt('이동할 묶음 이름',g.name);const target=groups.find(x=>x.name===dest&&x.id!==g.id);if(target&&duplicated(r.id,target.shopId)){alert('이동할 가게에 같은 이름의 방이 있습니다. 이름을 변경한 후 이동해 주세요.');return}if(target)setStore(v=>({...v,rooms:v.rooms.map(x=>roomKey(x)===roomKey(r)?{...x,groupId:target.id}:x),groups:(v.groups??[]).map(x=>x.id===g.id?{...x,layout:x.layout.map(y=>y===roomKey(r)?null:y)}:x)}))}}>이동</button><button onClick={e=>{e.stopPropagation();if(r.started||r.tags.length){alert('이용 중인 방은 삭제할 수 없습니다.');return}if(confirm(r.id+' 삭제할까요?'))setStore(v=>({...v,rooms:v.rooms.filter(x=>roomKey(x)!==roomKey(r)),groups:(v.groups??[]).map(x=>({...x,layout:x.layout.map(y=>y===roomKey(r)?null:y)}))}))}}>삭제</button></div>}
              {!editing&&chosen&&<button className="place" onClick={e=>{e.stopPropagation();place(chosen,roomKey(r))}}>+ {chosen} 배치</button>}
              {!editing&&r.started&&<button className={'room-pay '+(expired?'attention':'')} onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();openCheckout(roomKey(r))}}>{expired?'⚠ 결제 필요':'결제'}</button>}
            </div>
          })}</div>
        </section>
      })}</div>)}
.map(x=>x.id===g.id?{...x,layout:x.layout.map(y=>y===r.id?null:y)}:x)}))}}>이동</button><button onClick={e=>{e.stopPropagation();if(r.started||r.tags.length){alert('이용 중인 방은 삭제할 수 없습니다.');return}if(confirm(r.id+' 삭제할까요?'))setStore(v=>({...v,rooms:v.rooms.filter(x=>x.id!==r.id),groups:(v.groups??[]).map(x=>({...x,layout:x.layout.map(y=>y===r.id?null:y)}))}))}}>삭제</button></div>}
              {!editing&&chosen&&<button className="place" onClick={e=>{e.stopPropagation();place(chosen,roomKey(r))}}>+ {chosen} 배치</button>}
              {!editing&&r.started&&<button className={'room-pay '+(expired?'attention':'')} onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();openCheckout(roomKey(r))}}>{expired?'⚠ 결제 필요':'결제'}</button>}
            </div>
          })}</div>
        </section>
      })}
      <div className="section"><h2>태그 보관함</h2><button onClick={() => { const tag = prompt('태그 이름')?.trim(); if (tag) setStore(s => ({ ...s, tags: s.tags.includes(tag) ? s.tags : [...s.tags, tag] })) }}>+ 태그 추가</button></div>
      <p className="hint">태그 선택 → 방 선택으로 배치</p><div className="tag-list">{store.tags.map(tag => <button key={tag} draggable onDragStart={e => e.dataTransfer.setData('text/plain', tag)} className={chosen === tag ? 'picked' : ''} onClick={() => setChosen(chosen === tag ? null : tag)}>{tag}{store.rooms.some(r => r.tags.includes(tag)) ? ' ✓' : ''}<small>{(() => { const visit = store.visits.find(v => v.tag === tag && v.exited === null); return visit ? `${visit.room} · ${Math.floor((now - visit.entered) / 60000)}분` : '대기' })()}</small></button>)}</div>
      <p className="hint">방 한 번 터치: 상세 · 두 번 터치: +1시간 · 길게 누르기: 시간 조절</p>
    </main>}
    {page === 'logs' && <main>
      <div className="section"><h2>{historyRoom ? historyRoom + ' 진행 기록' : '방별 진행 기록'}</h2>{historyRoom && <button onClick={() => setHistoryRoom(null)}>← 방 목록</button>}</div>
      {!historyRoom ? <div className="history-rooms">{[...new Set([...store.rooms.map(r => r.id), ...store.logs.map(l => l.room), ...store.sessions.map(x => x.room), ...(store.payments ?? []).map(x => x.room)])].map(id => <button key={id} onClick={() => { setHistoryRoom(id); setDay('') }}><strong>{id}</strong><span>이용 회차 {store.sessions.filter(x => x.room === id).length}건 · 결제 {(store.payments ?? []).filter(x => x.room === id).length}건</span><b>›</b></button>)}</div> : <>
        <div className="filters"><input type="date" value={day} onChange={e => setDay(e.target.value)}/><button onClick={() => setDay('')}>전체 날짜</button></div>
        <h3>이용 회차</h3><div className="sessions">{store.sessions.filter(x => x.room === historyRoom && (!day || new Date(x.started).toLocaleDateString('en-CA') === day)).map(x => <button key={x.id} onClick={() => setViewSession(x.id)}>{date(x.started)} · {x.ended ? '종료' : '진행 중'} ›</button>)}</div>
        <h3>결제 내역</h3><div className="logs">{(store.payments ?? []).filter(x => x.room === historyRoom && (!day || new Date(x.at).toLocaleDateString('en-CA') === day)).map(x => <div className="log" key={x.id}><b>{x.method}</b><div><strong>{x.amount.toLocaleString('ko-KR')}원</strong><small>{date(x.at)} · {x.method === '미수' ? '미수 등록' : '결제 기록'}</small>{x.manager && <small>담당: {x.manager}</small>}{x.memo && <small>비고: {x.memo}</small>}</div></div>)}</div>
        <h3>활동 로그</h3><div className="logs">{store.logs.filter(x => x.room === historyRoom && (!day || new Date(x.at).toLocaleDateString('en-CA') === day)).map(x => <div className="log" key={x.id}><b>{x.room}</b><div><strong>{x.action}</strong><small>{date(x.at)}</small></div></div>)}</div>
      </>}
    </main>}
    {page==='payments'&&<main><h2>결제 현황</h2><div className="shop-tabs"><button className={payShopTab==='all'?'active':''} onClick={()=>{setPayShopTab('all');setPayGroup('all')}}>전체</button>{shops.map(sh=><button key={sh.id} className={payShopTab===sh.id?'active':''} onClick={()=>{setPayShopTab(sh.id);setPayGroup('all')}}>{sh.name}</button>)}</div><div className="filters"><input type="date" value={payDay} onChange={e=>setPayDay(e.target.value)}/><button onClick={()=>setPayDay('')}>전체 날짜</button><select value={payGroup} onChange={e=>setPayGroup(e.target.value)}><option value="all">전체 묶음</option>{groups.filter(g=>payShopTab==='all'||g.shopId===payShopTab).map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
      {(()=>{const items=(store.payments??[]).filter(p=>(payShopTab==='all'||p.shopId===payShopTab)&&(payGroup==='all'||p.groupId===payGroup)&&(!payDay||new Date(p.at).toLocaleDateString('sv-SE')===payDay));const paid=items.filter(p=>p.method!=='미수').reduce((n,p)=>n+p.amount,0),due=items.filter(p=>p.method==='미수').reduce((n,p)=>n+p.amount,0);return <><div className="payment-summary"><div><small>수금 합계</small><strong>{paid.toLocaleString('ko-KR')}원</strong></div><div><small>미수 합계</small><strong>{due.toLocaleString('ko-KR')}원</strong></div></div><h3>묶음별 결제</h3>{groups.filter(g=>payShopTab==='all'||g.shopId===payShopTab).filter(g=>payGroup==='all'||g.id===payGroup).map(g=>{const rows=items.filter(p=>p.groupId===g.id);return <button className="group-payment" key={g.id} onClick={()=>setPayGroup(g.id)}><b>{shops.find(x=>x.id===g.shopId)?.name} · {g.name}</b><span>수금 {rows.filter(p=>p.method!=='미수').reduce((n,p)=>n+p.amount,0).toLocaleString('ko-KR')}원</span><span>미수 {rows.filter(p=>p.method==='미수').reduce((n,p)=>n+p.amount,0).toLocaleString('ko-KR')}원</span></button>})}<div className="section"><h3>결제 내역 · 특이사항</h3><label className="memo-filter"><input type="checkbox" checked={memoOnly} onChange={e=>setMemoOnly(e.target.checked)}/> 비고만</label></div>{items.filter(p=>!memoOnly||Boolean(p.memo?.trim())).map(p=><div className="payment-entry" key={p.id}><strong>{p.room} · {p.method} · {p.amount.toLocaleString('ko-KR')}원</strong><small>{shops.find(x=>x.id===p.shopId)?.name} / {groups.find(g=>g.id===p.groupId)?.name} · {date(p.at)}</small>{p.manager&&<small>담당: {p.manager}</small>}{p.wari&&<small>와리: {p.wari}</small>}{p.wt&&<small>WT: {p.wt}</small>}{p.memo&&<p>비고: {p.memo}</p>}</div>)}{items.length===0&&<p className="hint">해당 기간의 결제 기록이 없습니다.</p>}</>})()}</main>}
    {page==='settings'&&<main><h2>설정</h2><h3>결제 입력 항목</h3><label className="setting-row"><span>와리 표시</span><input type="checkbox" checked={store.showWari!==false} onChange={e=>setStore(v=>({...v,showWari:e.target.checked}))}/></label><label className="setting-row"><span>WT 표시</span><input type="checkbox" checked={store.showWt!==false} onChange={e=>setStore(v=>({...v,showWt:e.target.checked}))}/></label><h3>가게 관리</h3>{shops.map(sh=><div className="manage-row" key={sh.id}><b>{sh.name}</b><button onClick={()=>renameShop(sh.id)}>이름 변경</button></div>)}<button className="manage-add" onClick={()=>{const name=prompt('추가할 가게 이름')?.trim();if(name){if(shops.some(x=>x.name.toLocaleLowerCase()===name.toLocaleLowerCase())){alert('이미 등록된 가게 이름입니다.');return}setStore(v=>({...v,shops:[...(v.shops??[]),{id:crypto.randomUUID(),name}]}))}}}>+ 가게 추가</button><h3>방 묶음 관리</h3>{groups.map(g=><div className="manage-row" key={g.id}><div><b>{g.name}</b><small>{shops.find(sh=>sh.id===g.shopId)?.name}</small></div><button onClick={()=>{const name=prompt('묶음 이름',g.name)?.trim();if(name)setStore(v=>({...v,groups:(v.groups??[]).map(x=>x.id===g.id?{...x,name}:x)}))}}>이름</button><button onClick={()=>{if(store.rooms.some(r=>r.groupId===g.id)){alert('방이 있는 묶음은 삭제할 수 없습니다.');return}if(confirm(g.name+' 삭제할까요?'))setStore(v=>({...v,groups:(v.groups??[]).filter(x=>x.id!==g.id)}))}}>삭제</button></div>)}<button className="manage-add" onClick={()=>{const name=prompt('새 묶음 이름')?.trim();if(!name)return;const sh=prompt('소속 가게 이름',shops[0]?.name);const target=shops.find(x=>x.name===sh);if(!target){alert('등록된 가게 이름을 입력해 주세요.');return}setStore(v=>({...v,groups:[...(v.groups??[]),{id:crypto.randomUUID(),shopId:target.id,name,layout:[]}]}))}}>+ 묶음 추가</button><p className="hint">이 버전은 현재 브라우저에만 저장됩니다. 두 가게 기기 간 실시간 공유는 아직 지원하지 않습니다.</p><button className="danger" onClick={()=>{if(confirm('모든 테스트 기록을 삭제할까요?'))setStore(seed)}}>테스트 기록 초기화</button></main>}
    <nav className="nav-four"><button className={page === 'rooms' ? 'on' : ''} onClick={() => setPage('rooms')}>▦<span>방 현황</span></button><button className={page === 'logs' ? 'on' : ''} onClick={() => setPage('logs')}>◷<span>진행 기록</span></button><button className={page === 'payments' ? 'on' : ''} onClick={() => setPage('payments')}>₩<span>결제</span></button><button className={page === 'settings' ? 'on' : ''} onClick={() => setPage('settings')}>⚙<span>설정</span></button></nav>
    {newRoomGroup&&<div className="overlay" onClick={()=>setNewRoomGroup(null)}><section className="modal" onClick={e=>e.stopPropagation()}><h2>방 추가</h2><p className="hint">{shops.find(sh=>sh.id===groups.find(g=>g.id===newRoomGroup)?.shopId)?.name} · {groups.find(g=>g.id===newRoomGroup)?.name}</p><label className="amount-label">방 이름<input autoFocus value={newRoomName} onChange={e=>{setNewRoomName(e.target.value.toUpperCase());setRoomError('')}} placeholder="예: 1T" maxLength={40}/></label>{roomError&&<p className="form-error">{roomError}</p>}<div className="buttons"><button onClick={()=>setNewRoomGroup(null)}>취소</button><button onClick={()=>{const name=newRoomName.trim().toUpperCase();const g=groups.find(x=>x.id===newRoomGroup);if(!name||!g){setRoomError('방 이름을 입력해 주세요.');return}if(duplicated(name,g.shopId)){setRoomError('같은 가게에 이미 등록된 방 이름입니다. 다른 이름을 입력해 주세요.');return}setStore(v=>({...v,rooms:[...v.rooms,{uid:crypto.randomUUID(),id:name,groupId:g.id,started:null,ends:null,tags:[]}]}));setNewRoomGroup(null);setNewRoomName('');setRoomError('')}}>방 추가 완료</button></div></section></div>}
    {selected && <div className="overlay" onClick={() => setDetail(null)}><section className="modal" onClick={e => e.stopPropagation()}><div className="section"><h2>{selected.id} 상세</h2><button onClick={() => setDetail(null)}>닫기</button></div><div className="large-time">{selected.ends ? format(selected.ends - now) : '대기 중'}</div><p className="hint">{selected.started ? `시작: ${date(selected.started)}` : '시작 전'}</p><div className="buttons"><button onClick={() => selected.ends ? changeTime(roomKey(selected), 60) : start(roomKey(selected))}>{selected.ends ? '+1시간' : '60분 시작'}</button><button onClick={() => { setAdjust(roomKey(selected)); setDetail(null) }}>시간 조절</button>{selected.started && <button className="checkout-open" onClick={() => { openCheckout(roomKey(selected)) }}>마무리 (결제)</button>}</div><h3>배치된 태그</h3>{selected.tags.map(tag => <div className="tag-row" key={tag}><span>{tag}<small>{(() => { const v = store.visits.find(x => x.tag === tag && x.exited === null); return v ? ` · 입실 ${date(v.entered)} · ${Math.floor((now - v.entered)/60000)}분 경과` : '' })()}</small></span><button onClick={() => place(tag, null)}>퇴실</button></div>)}{!selected.tags.length && <p className="hint">태그 없음</p>}</section></div>}
    {checkout && <div className="overlay" onClick={() => setCheckout(null)}><section className="modal" onClick={e => e.stopPropagation()}><div className="section"><h2>{roomName(checkout)} · 마무리(결제)</h2><button onClick={() => setCheckout(null)}>취소</button></div><p className="hint">결제 수단을 선택하고 금액을 입력한 후 완료하세요. 미수는 실제 수금이 아닌 미수 기록으로 저장됩니다.</p><div className="pay-methods">{(['카드','현금','이체','미수'] as const).map(m => <button key={m} className={payMethod === m ? 'active' : ''} onClick={() => setPayMethod(m)}>{m}</button>)}</div><label className="amount-label">{payMethod === '미수' ? '미수 금액' : '결제금액'} (원)<input inputMode="numeric" type="text" pattern="[0-9]*" placeholder="예: 150000" value={payAmount} onChange={e => setPayAmount(e.target.value.replace(/[^0-9]/g,''))}/></label><label className="amount-label checkout-extra">담당<input type="text" maxLength={80} placeholder="담당자 이름 입력" value={payManager} onChange={e => setPayManager(e.target.value)}/></label>{store.showWari!==false&&<label className="amount-label checkout-extra">와리<input type="text" value={payWari} onChange={e=>setPayWari(e.target.value)} placeholder="와리 입력"/></label>}{store.showWt!==false&&<label className="amount-label checkout-extra">WT<input type="text" value={payWt} onChange={e=>setPayWt(e.target.value)} placeholder="WT 입력"/></label>}<label className="amount-label checkout-extra">비고 (메모)<textarea rows={3} maxLength={1000} placeholder="결제 관련 메모 입력" value={payMemo} onChange={e => setPayMemo(e.target.value)}/></label><button className="pay-submit" disabled={!payMethod || !payAmount || Number(payAmount) <= 0} onClick={saveCheckout}>완료 · 기록 저장 및 방 마무리</button></section></div>}
    {adjust && <div className="overlay" onClick={() => setAdjust(null)}><section className="modal" onClick={e => e.stopPropagation()}><div className="section"><h2>{roomName(adjust)} 시간 조절</h2><button onClick={() => setAdjust(null)}>닫기</button></div><p className="hint">시간 추가</p><div className="adjust">{[5, 10, 30, 60].map(m => <button className="plus" key={m} onClick={() => changeTime(adjust, m)}>+{m === 60 ? '1시간' : m + '분'}</button>)}</div><p className="hint">시간 차감</p><div className="adjust">{[5, 10, 30, 60].map(m => <button className="minus" key={m} onClick={() => changeTime(adjust, -m)}>-{m === 60 ? '1시간' : m + '분'}</button>)}</div></section></div>}
    {viewSession && <div className="overlay" onClick={() => setViewSession(null)}><section className="modal" onClick={e => e.stopPropagation()}><div className="section"><h2>이용 회차 상세</h2><button onClick={() => setViewSession(null)}>닫기</button></div>{(() => { const x = store.sessions.find(s => s.id === viewSession); if (!x) return null; const next = store.sessions.filter(s => s.room === x.room && s.started > x.started).sort((a,b) => a.started-b.started)[0]; const end = x.ended ?? next?.started ?? now; return <><p>{x.room} · 시작 {date(x.started)}</p><p>종료 {x.ended ? date(x.ended) : '진행 중'} · 경과 {Math.floor((end-x.started)/60000)}분</p><h3>태그 입퇴실</h3>{store.visits.filter(v => v.room === x.room && v.entered >= x.started && v.entered <= end).map(v => <p className="visit" key={v.id}>{v.tag} · 입실 {date(v.entered)} · 퇴실 {v.exited ? date(v.exited) : '이용 중'}</p>)}<h3>조작 기록</h3>{store.logs.filter(l => l.room === x.room && l.at >= x.started && l.at <= end).map(l => <p className="visit" key={l.id}>{date(l.at)} · {l.action}</p>)}</> })()}</section></div>}
  </div>
}
