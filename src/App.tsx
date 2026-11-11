import { useEffect, useRef, useState } from 'react'
import './App.css'

type Room = { id: string; started: number | null; ends: number | null; tags: string[] }
type Log = { id: string; at: number; room: string; action: string }
type Visit = { id: string; tag: string; room: string; entered: number; exited: number | null }
type Session = { id: string; room: string; started: number; ended: number | null }
type Payment = { id: string; room: string; at: number; amount: number; method: '카드' | '현금' | '이체' | '미수'; sessionId: string | null; manager?: string; memo?: string }
type Store = { rooms: Room[]; tags: string[]; logs: Log[]; visits: Visit[]; sessions: Session[]; payments: Payment[] }
const seed: Store = { rooms: Array.from({ length: 6 }, (_, i) => ({ id: `${i + 1}T`, started: null, ends: null, tags: [] })), tags: ['A01', 'A02', 'A03', 'A04', 'A05', 'A06'], logs: [], visits: [], sessions: [], payments: [] }
function read(): Store { try { const raw = localStorage.getItem('room-live-v1'); return raw ? { ...seed, ...JSON.parse(raw) as Store } : seed } catch { return seed } }
const format = (ms: number) => { const n = Math.max(0, Math.ceil(ms / 1000)); return [Math.floor(n / 3600), Math.floor(n % 3600 / 60), n % 60].map(x => String(x).padStart(2, '0')).join(':') }
const date = (n: number) => new Date(n).toLocaleString('ko-KR', { hour12: false })
export default function App() {
  const [store, setStore] = useState<Store>(read)
  const [now, setNow] = useState(Date.now())
  const [page, setPage] = useState<'rooms' | 'logs' | 'settings'>('rooms')
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
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null)
  const held = useRef(false)
  const tap = useRef<{ room: string; time: number } | null>(null)
  useEffect(() => { const interval = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(interval) }, [])
  useEffect(() => { localStorage.setItem('room-live-v1', JSON.stringify(store)) }, [store])
  const record = (room: string, action: string): Log => ({ id: crypto.randomUUID(), at: Date.now(), room, action })
  const rearrange = (from: string, to: string) => { setStore(v => { const rooms = [...v.rooms]; const i = rooms.findIndex(r => r.id === from), j = rooms.findIndex(r => r.id === to); if (i < 0 || j < 0 || i === j) return v; rooms.splice(j, 0, ...rooms.splice(i, 1)); return { ...v, rooms } }); setMoving(null) }
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  function changeTime(id: string, minutes: number) {
    setStore(s => {
      const room = s.rooms.find(r => r.id === id)
      if (!room || (!room.ends && minutes < 0)) return s
      const time = Date.now()
      return { ...s, rooms: s.rooms.map(r => r.id !== id ? r : { ...r, started: r.started ?? time, ends: Math.max(time, (r.ends ?? time) + minutes * 60000) }), logs: [record(id, `시간 ${minutes > 0 ? '+' : ''}${minutes}분 · 변경 전 ${room.ends ? format(room.ends - time) : '대기'} → 변경 후 ${format(Math.max(time, (room.ends ?? time) + minutes * 60000) - time)}`), ...s.logs], sessions: room.started ? s.sessions : [{ id: crypto.randomUUID(), room: id, started: time, ended: null }, ...s.sessions] }
    })
    setAdjust(null)
  }
  function start(id: string) { const at = Date.now(); setStore(s => ({ ...s, rooms: s.rooms.map(r => r.id === id ? { ...r, started: at, ends: at + 3600000 } : r), sessions: [{ id: crypto.randomUUID(), room: id, started: at, ended: null }, ...s.sessions], logs: [record(id, '방 시작 · 60분'), ...s.logs] })) }
  function saveCheckout() {
    if (!checkout || !payMethod) { alert('결제 수단을 선택해 주세요.'); return }
    if (!/^\d+$/.test(payAmount.trim()) || !Number.isSafeInteger(Number(payAmount)) || Number(payAmount) <= 0) { alert('결제금액을 1원 이상의 숫자로 입력해 주세요.'); return }
    const r = store.rooms.find(x => x.id === checkout)
    if (!r || !r.started) { alert('진행 중인 방이 아닙니다.'); return }
    const at = Date.now(), amount = Number(payAmount)
    const payment: Payment = { id: crypto.randomUUID(), room: checkout, at, amount, method: payMethod, sessionId: store.sessions.filter(x => x.room === checkout && x.ended === null).sort((a,b) => b.started-a.started)[0]?.id ?? null, manager: payManager.trim(), memo: payMemo.trim() }
    setStore(v => ({ ...v, payments: [payment, ...(v.payments ?? [])], sessions: v.sessions.map(x => x.room === checkout && x.ended === null ? { ...x, ended: at } : x), visits: v.visits.map(x => x.room === checkout && x.exited === null ? { ...x, exited: at } : x), rooms: v.rooms.map(x => x.id === checkout ? { ...x, started: null, ends: null, tags: [] } : x), logs: [record(checkout, `마무리(결제) · ${payMethod} · ${amount.toLocaleString('ko-KR')}원`), ...r.tags.map(tag => record(checkout, `${tag} 퇴실 · 결제 완료`)), ...v.logs] }))
    setCheckout(null); setDetail(null); setPayMethod(null); setPayAmount(''); setPayManager(''); setPayMemo('')
  }
  function place(tag: string, destination: string | null) {
    setStore(s => {
      const origin = s.rooms.find(r => r.tags.includes(tag))?.id
      if (origin === destination) return s
      const at = Date.now()
      const logs = [...(origin ? [record(origin, `${tag} 퇴실`)] : []), ...(destination ? [record(destination, `${tag} 입실`)] : [])]
      return { ...s, rooms: s.rooms.map(r => ({ ...r, tags: r.id === destination ? [...r.tags.filter(t => t !== tag), tag] : r.tags.filter(t => t !== tag) })), logs: [...logs, ...s.logs], visits: [...(destination ? [{ id: crypto.randomUUID(), tag, room: destination, entered: at, exited: null }] : []), ...s.visits.map(v => v.tag === tag && v.exited === null ? { ...v, exited: at } : v)] }
    })
    setChosen(null)
  }
  function roomTap(id: string) {
    if (held.current) { held.current = false; return }
    if (editing) { if (moving) rearrange(moving, id); else setMoving(id); return }
    if (chosen) { place(chosen, id); return }
    const t = Date.now()
    if (tap.current?.room === id && t - tap.current.time < 350) { tap.current = null; changeTime(id, 60) }
    else { tap.current = { room: id, time: t }; setTimeout(() => { if (tap.current?.room === id && tap.current.time === t) { tap.current = null; setDetail(id) } }, 360) }
  }
  const selected = store.rooms.find(r => r.id === detail)
  return <div className="app">
    <header><div><span className="kicker">ROOM LIVE · v0.2</span><h1>룸 라이브</h1><p>방 · 태그 · 시간 통합 관리</p></div><span className="status">● 로컬 테스트</span></header>
    {page === 'rooms' && <main>
      <div className="section"><h2>방 현황 <small>{store.rooms.length}개</small></h2><button onClick={() => { setEditing(!editing); setMoving(null); setChosen(null) }}>{editing ? '편집 완료' : '배치 편집'}</button><button onClick={() => { const id = prompt('새 방 이름 (예: 7T)')?.trim().toUpperCase(); if (id) setStore(s => s.rooms.some(r => r.id === id) ? s : { ...s, rooms: [...s.rooms, { id, started: null, ends: null, tags: [] }] }) }}>+ 방 추가</button></div>
      {editing && <p className="hint">이동할 방을 누른 다음 원하는 위치의 방을 누르세요. PC에서는 드래그로 이동할 수 있습니다.</p>}<div className="room-grid">{store.rooms.map(r => <div key={r.id} className={`room ${r.ends ? 'running' : ''} ${moving === r.id ? 'moving' : ''}`} draggable={editing} onDragStart={e => { if (editing) e.dataTransfer.setData('room', r.id) }} onPointerDown={e => { touchStart.current = { x: e.clientX, y: e.clientY }; held.current = false; if (!editing && !chosen) hold.current = setTimeout(() => { held.current = true; setDetail(null); setAdjust(r.id) }, 550) }} onPointerMove={e => { if (touchStart.current && Math.hypot(e.clientX - touchStart.current.x, e.clientY - touchStart.current.y) > 12 && hold.current) clearTimeout(hold.current) }} onPointerUp={() => { if (hold.current) clearTimeout(hold.current) }} onPointerLeave={() => { if (hold.current) clearTimeout(hold.current) }} onPointerCancel={() => { if (hold.current) clearTimeout(hold.current) }} onContextMenu={e => { e.preventDefault(); if (!editing && !chosen) { held.current = true; setAdjust(r.id) } }} onClick={() => roomTap(r.id)} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const from = e.dataTransfer.getData('room'); const tag = e.dataTransfer.getData('text/plain'); if (editing && from) rearrange(from, r.id); else if (!editing && tag) place(tag, r.id) }}>
        <div className="room-head"><strong>{r.id}</strong><span>{r.ends ? '이용 중' : '대기'}</span></div><div className="time">{r.ends ? format(r.ends - now) : '--:--:--'}</div><div className="tags">{r.tags.length ? r.tags.join(' · ') : '태그 없음'}</div>{editing && <div className="room-tools"><button onClick={e => { e.stopPropagation(); const name = prompt('새 방 이름', r.id)?.trim().toUpperCase(); if (name && !store.rooms.some(x => x.id === name)) setStore(v => ({ ...v, rooms: v.rooms.map(x => x.id === r.id ? { ...x, id: name } : x), logs: v.logs.map(x => x.room === r.id ? { ...x, room: name } : x), visits: v.visits.map(x => x.room === r.id ? { ...x, room: name } : x), sessions: v.sessions.map(x => x.room === r.id ? { ...x, room: name } : x) })) }}>이름</button><button onClick={e => { e.stopPropagation(); if (r.started || r.tags.length) { alert('이용 중인 방은 삭제할 수 없습니다.'); return } if (confirm(r.id + ' 삭제할까요?')) setStore(v => ({ ...v, rooms: v.rooms.filter(x => x.id !== r.id) })) }}>삭제</button></div>}{!editing && chosen && <button className="place" onClick={e => { e.stopPropagation(); place(chosen, r.id) }}>+ {chosen} 배치</button>}</div>)}</div>
      <div className="section"><h2>태그 보관함</h2><button onClick={() => { const tag = prompt('태그 이름')?.trim(); if (tag) setStore(s => ({ ...s, tags: s.tags.includes(tag) ? s.tags : [...s.tags, tag] })) }}>+ 태그 추가</button></div>
      <p className="hint">태그 선택 → 방 선택 또는 드래그로 배치</p><div className="tag-list">{store.tags.map(tag => <button key={tag} draggable onDragStart={e => e.dataTransfer.setData('text/plain', tag)} className={chosen === tag ? 'picked' : ''} onClick={() => setChosen(chosen === tag ? null : tag)}>{tag}{store.rooms.some(r => r.tags.includes(tag)) ? ' ✓' : ''}<small>{(() => { const visit = store.visits.find(v => v.tag === tag && v.exited === null); return visit ? `${visit.room} · ${Math.floor((now - visit.entered) / 60000)}분` : '대기' })()}</small></button>)}</div>
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
    {page === 'settings' && <main><h2>설정</h2><p className="hint">이 버전은 현재 기기에만 저장되는 테스트 앱입니다. 다른 직원과의 실시간 동기화는 Firebase 연결 후 가능합니다.</p><button className="danger" onClick={() => { if (confirm('모든 테스트 기록을 삭제할까요?')) setStore(seed) }}>테스트 기록 초기화</button></main>}
    <nav><button className={page === 'rooms' ? 'on' : ''} onClick={() => setPage('rooms')}>▦<span>방 현황</span></button><button className={page === 'logs' ? 'on' : ''} onClick={() => setPage('logs')}>◷<span>진행 기록</span></button><button className={page === 'settings' ? 'on' : ''} onClick={() => setPage('settings')}>⚙<span>설정</span></button></nav>
    {selected && <div className="overlay" onClick={() => setDetail(null)}><section className="modal" onClick={e => e.stopPropagation()}><div className="section"><h2>{selected.id} 상세</h2><button onClick={() => setDetail(null)}>닫기</button></div><div className="large-time">{selected.ends ? format(selected.ends - now) : '대기 중'}</div><p className="hint">{selected.started ? `시작: ${date(selected.started)}` : '시작 전'}</p><div className="buttons"><button onClick={() => selected.ends ? changeTime(selected.id, 60) : start(selected.id)}>{selected.ends ? '+1시간' : '60분 시작'}</button><button onClick={() => { setAdjust(selected.id); setDetail(null) }}>시간 조절</button>{selected.started && <button className="checkout-open" onClick={() => { setCheckout(selected.id); setPayMethod(null); setPayAmount(''); setPayManager(''); setPayMemo(''); setDetail(null) }}>마무리 (결제)</button>}</div><h3>배치된 태그</h3>{selected.tags.map(tag => <div className="tag-row" key={tag}><span>{tag}<small>{(() => { const v = store.visits.find(x => x.tag === tag && x.exited === null); return v ? ` · 입실 ${date(v.entered)} · ${Math.floor((now - v.entered)/60000)}분 경과` : '' })()}</small></span><button onClick={() => place(tag, null)}>퇴실</button></div>)}{!selected.tags.length && <p className="hint">태그 없음</p>}</section></div>}
    {checkout && <div className="overlay" onClick={() => setCheckout(null)}><section className="modal" onClick={e => e.stopPropagation()}><div className="section"><h2>{checkout} · 마무리(결제)</h2><button onClick={() => setCheckout(null)}>취소</button></div><p className="hint">결제 수단을 선택하고 금액을 입력한 후 완료하세요. 미수는 실제 수금이 아닌 미수 기록으로 저장됩니다.</p><div className="pay-methods">{(['카드','현금','이체','미수'] as const).map(m => <button key={m} className={payMethod === m ? 'active' : ''} onClick={() => setPayMethod(m)}>{m}</button>)}</div><label className="amount-label">{payMethod === '미수' ? '미수 금액' : '결제금액'} (원)<input inputMode="numeric" type="text" pattern="[0-9]*" placeholder="예: 150000" value={payAmount} onChange={e => setPayAmount(e.target.value.replace(/[^0-9]/g,''))}/></label><label className="amount-label checkout-extra">담당<input type="text" maxLength={80} placeholder="담당자 이름 입력" value={payManager} onChange={e => setPayManager(e.target.value)}/></label><label className="amount-label checkout-extra">비고 (메모)<textarea rows={3} maxLength={1000} placeholder="결제 관련 메모 입력" value={payMemo} onChange={e => setPayMemo(e.target.value)}/></label><button className="pay-submit" disabled={!payMethod || !payAmount || Number(payAmount) <= 0} onClick={saveCheckout}>완료 · 기록 저장 및 방 마무리</button></section></div>}
    {adjust && <div className="overlay" onClick={() => setAdjust(null)}><section className="modal" onClick={e => e.stopPropagation()}><div className="section"><h2>{adjust} 시간 조절</h2><button onClick={() => setAdjust(null)}>닫기</button></div><p className="hint">시간 추가</p><div className="adjust">{[5, 10, 30, 60].map(m => <button className="plus" key={m} onClick={() => changeTime(adjust, m)}>+{m === 60 ? '1시간' : m + '분'}</button>)}</div><p className="hint">시간 차감</p><div className="adjust">{[5, 10, 30, 60].map(m => <button className="minus" key={m} onClick={() => changeTime(adjust, -m)}>-{m === 60 ? '1시간' : m + '분'}</button>)}</div></section></div>}
    {viewSession && <div className="overlay" onClick={() => setViewSession(null)}><section className="modal" onClick={e => e.stopPropagation()}><div className="section"><h2>이용 회차 상세</h2><button onClick={() => setViewSession(null)}>닫기</button></div>{(() => { const x = store.sessions.find(s => s.id === viewSession); if (!x) return null; const next = store.sessions.filter(s => s.room === x.room && s.started > x.started).sort((a,b) => a.started-b.started)[0]; const end = x.ended ?? next?.started ?? now; return <><p>{x.room} · 시작 {date(x.started)}</p><p>종료 {x.ended ? date(x.ended) : '진행 중'} · 경과 {Math.floor((end-x.started)/60000)}분</p><h3>태그 입퇴실</h3>{store.visits.filter(v => v.room === x.room && v.entered >= x.started && v.entered <= end).map(v => <p className="visit" key={v.id}>{v.tag} · 입실 {date(v.entered)} · 퇴실 {v.exited ? date(v.exited) : '이용 중'}</p>)}<h3>조작 기록</h3>{store.logs.filter(l => l.room === x.room && l.at >= x.started && l.at <= end).map(l => <p className="visit" key={l.id}>{date(l.at)} · {l.action}</p>)}</> })()}</section></div>}
  </div>
}
