import { useState } from 'react'
import type { RoomHistory } from './store-model'
import { kstDate, operatingDay } from './store-model'

const time=(ms:number)=>new Date(ms).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false})
// Between 13:00 and 17:00 KST the preceding business day remains on screen.
const businessDay=(ms:number)=>operatingDay(ms)??kstDate(ms-86400000)

export default function TodayHistory({records,now}:{records:RoomHistory[];now:number}){
  const [expanded,setExpanded]=useState<string|null>(null)
  const [shop,setShop]=useState('전체')
  const today=businessDay(now)
  const shops=[...new Set(records.filter(r=>businessDay(r.started??r.ended)===today).map(r=>r.shop))]
  const rows=records.filter(r=>businessDay(r.started??r.ended)===today&&(shop==='전체'||r.shop===shop)).sort((a,b)=>b.ended-a.ended)
  return <main className="today-history">
    <div className="section"><h2>오늘의 진행 기록</h2><small>{today} 영업일</small></div>
    {shops.length>1&&<div className="history-shop-tabs"><button type="button" className={shop==='전체'?'active':''} onClick={()=>setShop('전체')}>전체</button>{shops.map(name=><button type="button" key={name} className={shop===name?'active':''} onClick={()=>setShop(name)}>{name}</button>)}</div>}
    {rows.length===0?<p className="history-empty">오늘 종료된 진행 기록이 없습니다.</p>:<div className="today-history-list">{rows.map(run=>{
      const open=expanded===run.id
      const names=[...new Set(run.staff.map(v=>v.name))]
      return <article className="today-history-card" key={run.id}>
        <button className="today-history-summary" type="button" aria-expanded={open} onClick={()=>setExpanded(open?null:run.id)}>
          <strong className="history-room-name">{run.room}</strong>
          <span className="history-summary-body"><strong>{run.outcome==='cancel'?'진행삭제':(names.length?names.join(' · '):'배치 직원 없음')+' (마무리)'}</strong><small>{run.shop} · {time(run.ended)} {run.outcome==='cancel'?'진행삭제':'마무리'}</small></span>
          <span className="history-chevron" aria-hidden="true">{open?'⌃':'⌄'}</span>
        </button>
        {open&&<div className="today-history-detail">
          <div className="history-time-pair"><div><small>방 시작</small><strong>{run.started?time(run.started):'기록 없음'}</strong></div><div><small>{run.outcome==='cancel'?'진행삭제':'마무리'}</small><strong>{time(run.ended)}</strong></div></div>
          <h3>직원 입퇴실 기록</h3>
          {run.staff.length?<div className="history-staff-list">{run.staff.map((visit,i)=><div className="history-staff-row" key={visit.tag+'-'+visit.entered+'-'+i}><strong>{visit.name}</strong><span>입실 <b>{time(visit.entered)}</b></span><span>퇴실 <b>{visit.exited?time(visit.exited):'기록 없음'}</b></span></div>)}</div>:<p className="history-muted">배치된 직원 기록 없음</p>}
          <h3>방 메모</h3><div className="history-memo">{run.memo.trim()||'메모 없음'}</div>
          {run.events.length>0&&<><h3>진행 타임라인</h3><div className="history-event-list">{run.events.map((event,i)=><div key={i}><time>{time(event.at)}</time><span>{event.action}</span></div>)}</div></>}
        </div>}
      </article>
    })}</div>}
  </main>
}
