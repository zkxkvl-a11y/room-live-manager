import { useEffect, useRef, useState } from 'react'
import './App.css'

type Room = { id: string; started: number | null; ends: number | null; tags: string[] }
type Log = { id: string; at: number; room: string; action: string }
type Store = { rooms: Room[]; tags: string[]; logs: Log[] }
const seed: Store = { rooms: Array.from({ length: 6 }, (_, i) => ({ id: `${i + 1}T`, started: null, ends: null, tags: [] })), tags: ['A01', 'A02', 'A03', 'A04', 'A05', 'A06'], logs: [] }
function read(): Store { try { const raw = localStorage.getItem('room-live-v1'); return raw ? JSON.parse(raw) as Store : seed } catch { return seed } }
const format = (ms: number) => { const n = Math.max(0, Math.ceil(ms / 1000)); return [Math.floor(n / 3600), Math.floor(n % 3600 / 60), n % 60].map(x => String(x).padStart(2, '0')).join(':') }
const date = (n: number) => new Date(n).toLocaleString('ko-KR', { hour12: false })
export default function App() {
  const [store, setStore] = useState<Store>(read)
  const [now, setNow] = useState(Date.now())
  const [page, setPage] = useState<'rooms' | 'logs' | 'settings'>('rooms')
  const [detail, setDetail] = useState<string | null>(null)
  const [adjust, setAdjust] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const [filter, setFilter] = useState('전체')
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null)
  const held = useRef(false)
  const tap = useRef<{ room: string; time: number } | null>(null)
  useEffect(() => { const interval = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(interval) }, [])
  useEffect(() => { localStorage.setItem('room-live-v1', JSON.stringify(store)) }, [store])
  const record = (room: string, action: string): Log => ({ id: crypto.randomUUID(), at: Date.now(), room, action })
  function changeTime(id: string, minutes: number) {
    setStore(s => {
      const room = s.rooms.find(r => r.id === id)
      if (!room || (!room.ends && minutes < 0)) return s
      const time = Date.now()
      return { ...s, rooms: s.rooms.map(r => r.id !== id ? r : { ...r, started: r.started ?? time, ends: Math.max(time, (r.ends ?? time) + minutes * 60000) }), logs: [record(id, `시간 ${minutes > 0 ? '+' : ''}${minutes}분`), ...s.logs] }
    })
    setAdjust(null)
  }
  function start(id: string) { setStore(s => ({ ...s, rooms: s.rooms.map(r => r.id === id ? { ...r, started: Date.now(), ends: Date.now() + 3600000 } : r), logs: [record(id, '방 시작 · 60분'), ...s.logs] })) }
  function end(id: string) {
    if (!confirm(`${id} 이용을 종료할까요?`)) return
    setStore(s => {
      const r = s.rooms.find(x => x.id === id)
      return { ...s, rooms: s.rooms.map(x => x.id === id ? { ...x, started: null, ends: null, tags: [] } : x), logs: [...(r?.tags.map(tag => record(id, `${tag} 퇴실 · 방 종료`)) ?? []), record(id, '방 종료'), ...s.logs] }
    })
    setDetail(null)
  }
  function place(tag: string, destination: string | null) {
    setStore(s => {
      const origin = s.rooms.find(r => r.tags.includes(tag))?.id
      if (origin === destination) return s
      const logs = [...(origin ? [record(origin, `${tag} 퇴실`)] : []), ...(destination ? [record(destination, `${tag} 입실`)] : [])]
      return { ...s, rooms: s.rooms.map(r => ({ ...r, tags: r.id === destination ? [...r.tags.filter(t => t !== tag), tag] : r.tags.filter(t => t !== tag) })), logs: [...logs, ...s.logs] }
    })
    setChosen(null)
  }
  function roomTap(id: string) {
    if (held.current) { held.current = false; return }
    const t = Date.now()
    if (tap.current?.room === id && t - tap.current.time < 350) { tap.current = null; changeTime(id, 60) }
    else { tap.current = { room: id, time: t }; setTimeout(() => { if (tap.current?.room === id && tap.current.time === t) { tap.current = null; setDetail(id) } }, 360) }
  }
  const selected = store.rooms.find(r => r.id === detail)
  return <div className="app">
    <header><div><span className="kicker">ROOM LIVE</span><h1>룸 라이브</h1><p>방 · 태그 · 시간 통합 관리</p></div><span className="status">● 로컬 테스트</span></header>
    {page === 'rooms' && <main>
      <div className="section"><h2>방 현황 <small>{store.rooms.length}개</small></h2><button onClick={() => { const id = prompt('새 방 이름 (예: 7T)')?.trim().toUpperCase(); if (id) setStore(s => s.rooms.some(r => r.id === id) ? s : { ...s, rooms: [...s.rooms, { id, started: null, ends: null, tags: [] }] }) }}>+ 방 추가</button></div>
      <div className="room-grid">{store.rooms.map(r => <div key={r.id} className={`room ${r.ends ? 'running' : ''}`} onPointerDown={() => { held.current = false; hold.current = setTimeout(() => { held.current = true; setDetail(null); setAdjust(r.id) }, 550) }} onPointerUp={() => { if (hold.current) clearTimeout(hold.current) }} onPointerLeave={() => { if (hold.current) clearTimeout(hold.current) }} onPointerCancel={() => { if (hold.current) clearTimeout(hold.current) }} onContextMenu={e => { e.preventDefault(); held.current = true; setAdjust(r.id) }} onClick={() => roomTap(r.id)} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const tag = e.dataTransfer.getData('text/plain'); if (tag) place(tag, r.id) }}>
        <div className="room-head"><strong>{r.id}</strong><span>{r.ends ? '이용 중' : '대기'}</span></div><div className="time">{r.ends ? format(r.ends - now) : '--:--:--'}</div><div className="tags">{r.tags.length ? r.tags.join(' · ') : '태그 없음'}</div>{chosen && <button className="place" onClick={e => { e.stopPropagation(); place(chosen, r.id) }}>+ {chosen} 배치</button>}</div>)}</div>
      <div className="section"><h2>태그 보관함</h2><button onClick={() => { const tag = prompt('태그 이름')?.trim(); if (tag) setStore(s => ({ ...s, tags: s.tags.includes(tag) ? s.tags : [...s.tags, tag] })) }}>+ 태그 추가</button></div>
      <p className="hint">태그 선택 → 방 선택 또는 드래그로 배치</p><div className="tag-list">{store.tags.map(tag => <button key={tag} draggable onDragStart={e => e.dataTransfer.setData('text/plain', tag)} className={chosen === tag ? 'picked' : ''} onClick={() => setChosen(chosen === tag ? null : tag)}>{tag}{store.rooms.some(r => r.tags.includes(tag)) ? ' ✓' : ''}</button>)}</div>
      <p className="hint">방 한 번 터치: 상세 · 두 번 터치: +1시간 · 길게 누르기: 시간 조절</p>
    </main>}
    {page === 'logs' && <main><div className="section"><h2>방 진행 기록</h2><small>{store.logs.length}건</small></div><select value={filter} onChange={e => setFilter(e.target.value)}><option>전체</option>{store.rooms.map(r => <option key={r.id}>{r.id}</option>)}</select><div className="logs">{store.logs.filter(x => filter === '전체' || x.room === filter).map(log => <div className="log" key={log.id}><b>{log.room}</b><div><strong>{log.action}</strong><small>{date(log.at)}</small></div></div>)}{store.logs.length === 0 && <p className="hint">아직 진행 기록이 없습니다.</p>}</div></main>}
    {page === 'settings' && <main><h2>설정</h2><p className="hint">이 버전은 현재 기기에만 저장되는 테스트 앱입니다. 다른 직원과의 실시간 동기화는 Firebase 연결 후 가능합니다.</p><button className="danger" onClick={() => { if (confirm('모든 테스트 기록을 삭제할까요?')) setStore(seed) }}>테스트 기록 초기화</button></main>}
    <nav><button className={page === 'rooms' ? 'on' : ''} onClick={() => setPage('rooms')}>▦<span>방 현황</span></button><button className={page === 'logs' ? 'on' : ''} onClick={() => setPage('logs')}>◷<span>진행 기록</span></button><button className={page === 'settings' ? 'on' : ''} onClick={() => setPage('settings')}>⚙<span>설정</span></button></nav>
    {selected && <div className="overlay" onClick={() => setDetail(null)}><section className="modal" onClick={e => e.stopPropagation()}><div className="section"><h2>{selected.id} 상세</h2><button onClick={() => setDetail(null)}>닫기</button></div><div className="large-time">{selected.ends ? format(selected.ends - now) : '대기 중'}</div><p className="hint">{selected.started ? `시작: ${date(selected.started)}` : '시작 전'}</p><div className="buttons"><button onClick={() => selected.ends ? changeTime(selected.id, 60) : start(selected.id)}>{selected.ends ? '+1시간' : '60분 시작'}</button><button onClick={() => { setAdjust(selected.id); setDetail(null) }}>시간 조절</button>{selected.ends && <button className="danger" onClick={() => end(selected.id)}>방 종료</button>}</div><h3>배치된 태그</h3>{selected.tags.map(tag => <div className="tag-row" key={tag}><span>{tag}</span><button onClick={() => place(tag, null)}>퇴실</button></div>)}{!selected.tags.length && <p className="hint">태그 없음</p>}</section></div>}
    {adjust && <div className="overlay" onClick={() => setAdjust(null)}><section className="modal" onClick={e => e.stopPropagation()}><div className="section"><h2>{adjust} 시간 조절</h2><button onClick={() => setAdjust(null)}>닫기</button></div><p className="hint">시간 추가</p><div className="adjust">{[5, 10, 30, 60].map(m => <button className="plus" key={m} onClick={() => changeTime(adjust, m)}>+{m === 60 ? '1시간' : m + '분'}</button>)}</div><p className="hint">시간 차감</p><div className="adjust">{[5, 10, 30, 60].map(m => <button className="minus" key={m} onClick={() => changeTime(adjust, -m)}>-{m === 60 ? '1시간' : m + '분'}</button>)}</div></section></div>}
  </div>
}
