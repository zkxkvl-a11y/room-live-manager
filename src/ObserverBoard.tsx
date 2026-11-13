import { useState } from 'react'
import type { ObserverRoom,ObserverSnapshot } from './store-model'
import { format } from './store-model'

export default function ObserverBoard({snapshot,now,onLogout}:{snapshot:ObserverSnapshot;now:number;onLogout:()=>void}){
  const [shopTab,setShopTab]=useState('all')
  const [detailId,setDetailId]=useState<string|null>(null)
  const detail=(snapshot.rooms??[]).find(room=>room.uid===detailId)??null
  const shops=Array.from(new Set((snapshot.rooms??[]).map(r=>r.shop).filter(Boolean)))
  const visible=(snapshot.rooms??[]).filter(r=>shopTab==='all'||r.shop===shopTab)
  return <div className="app observer-mode">
    <header className="compact-header"><h1>룸 라이브</h1><span className="observer-role-tag">조회 전용</span><div className="header-shop-tabs" role="group" aria-label="가게 선택"><button type="button" className={shopTab==='all'?'active':''} onClick={()=>setShopTab('all')}>전체</button>{shops.map(shop=><button type="button" key={shop} className={shopTab===shop?'active':''} onClick={()=>setShopTab(shop)}>{shop}</button>)}</div></header>
    <main className="room-board">
      <div className="section"><h2>방 현황 <small>{snapshot.rooms?.length??0}개</small></h2><span className="observer-readonly-label">관전 모드</span></div>
      <section className="waiting-top" aria-label="대기 인원"><div className="waiting-top-heading"><strong>대기 인원 <small>{snapshot.waitingNames?.length??0}명</small></strong></div><div className="tag-list">{(snapshot.waitingNames??[]).map((name,i)=><span className="observer-staff-tag" key={i}>{name}</span>)}</div>{!snapshot.waitingNames?.length&&<p className="waiting-empty">대기 인원 없음</p>}</section>
      {shops.filter(shop=>shopTab==='all'||shop===shopTab).map(shop=><div className="shop-section" key={shop}><div className="shop-divider"><span>{shop}</span></div>{Array.from(new Set(visible.filter(r=>r.shop===shop).map(r=>r.group))).map(group=><section className="group-section" key={group}><div className="section"><h3>{shop} · {group}</h3><small>{visible.filter(r=>r.shop===shop&&r.group===group).length}개 방</small></div><div className="room-grid three-cols">{visible.filter(r=>r.shop===shop&&r.group===group).map(r=>{
        const active=Number.isFinite(r.started)&&Number(r.started)>0&&Number.isFinite(r.ends)&&Number(r.ends)>0&&!r.cleaning
        const remaining=active?Math.max(0,(r.ends??0)-now):0
        const stateClass=r.cleaning?'':active?(remaining<=180000?'room-state-critical':remaining<=600000?'room-state-warning':'room-state-active'):r.headcount?'room-state-choice':''
        return <button type="button" key={r.uid} className={'room observer-room-tile '+stateClass+(r.cleaning?' observer-room-cleaning':'')} onClick={()=>setDetailId(r.uid)}>
          <div className="observer-tile-top"><strong>{r.name}</strong><small>{r.headcount? r.headcount+'명':'인원'}</small></div>
          <span className="observer-tile-state">{r.cleaning?'청소대기중':active?'진행 중':r.headcount?'초이스 대기 중':'대기'}</span>
          <strong className="observer-tile-time">{r.cleaning?'청소대기':active?format(remaining):'--:--:--'}</strong>
          {r.memo&&<span className="observer-tile-memo">📝 {r.memo}</span>}
          <div className="observer-tile-staff">{(r.staffNames??[]).map((name,i)=><span key={i}>{name}</span>)}{!r.cleaning&&Array.from({length:Math.max(0,(r.headcount??0)-(r.staffNames??[]).length)},(_,i)=><span key={'vacancy-'+i} className="room-staff-vacancy" aria-label="부족 인원 1명">빵꾸</span>)}{!r.staffNames?.length&&!(r.headcount??0)&&<small>배치 인원 없음</small>}</div>
        </button>
      })}</div></section>)}</div>)}
      {!shops.length&&<p className="hint">표시할 방이 없습니다.</p>}
    </main>
    <nav className="nav-four observer-bottom"><button type="button" className="on" onClick={()=>setDetailId(null)}>▦<span>방 현황</span></button><button type="button" onClick={onLogout}>⇥<span>로그아웃</span></button></nav>
    {detail&&<div className="overlay" onClick={()=>setDetail(null)}><section className="modal observer-detail" onClick={e=>e.stopPropagation()}><div className="section"><h2>{detail.name} 상세</h2><button type="button" onClick={()=>setDetail(null)}>닫기</button></div><div className="observer-detail-time">{detail.cleaning?'청소대기중':Number.isFinite(detail.started)&&Number(detail.started)>0&&Number.isFinite(detail.ends)&&Number(detail.ends)>0?format(Math.max(0,Number(detail.ends)-now)):'대기 중'}</div>{detail.memo&&<p className="observer-detail-memo">📝 {detail.memo}</p>}<h3>배치된 인원</h3><div className="observer-tile-staff">{(detail.staffNames??[]).map((name,i)=><span key={i}>{name}</span>)}{!detail.staffNames?.length&&<p>배치 인원 없음</p>}</div><p className="hint">조회 전용 계정은 방 상태를 변경할 수 없습니다.</p></section></div>}
  </div>
}
