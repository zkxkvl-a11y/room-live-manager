import type { Store } from '../store-model'

export type LedgerIssue = {
  code:'DUPLICATE_ID'|'DUPLICATE_SESSION'|'MISSING_ROOM'|'INVALID_AMOUNT'|'OPEN_PAID_SESSION'|'MISSING_SESSION'
  paymentId:string
  detail:string
}

/** Read-only cutover gate. Never changes production records or silently deduplicates sales. */
export function auditLedger(store:Store):LedgerIssue[]{
  const issues:LedgerIssue[]=[]
  const ids=new Set<string>()
  const sessions=new Map<string,string>()
  const rooms=new Set(store.rooms.map(r=>r.uid??r.id))
  const sessionById=new Map(store.sessions.map(s=>[s.id,s]))
  for(const payment of store.payments){
    if(ids.has(payment.id))issues.push({code:'DUPLICATE_ID',paymentId:payment.id,detail:'중복 결제 ID'})
    ids.add(payment.id)
    if(!Number.isSafeInteger(payment.amount)||payment.amount<=0||payment.amount>1000000000)
      issues.push({code:'INVALID_AMOUNT',paymentId:payment.id,detail:'유효하지 않은 금액'})
    if(!rooms.has(payment.roomUid??payment.room))
      issues.push({code:'MISSING_ROOM',paymentId:payment.id,detail:'방 식별자 누락'})
    if(payment.sessionId){
      const prior=sessions.get(payment.sessionId)
      if(prior)issues.push({code:'DUPLICATE_SESSION',paymentId:payment.id,detail:'동일 회차 중복 결제: '+prior})
      sessions.set(payment.sessionId,payment.id)
      const session=sessionById.get(payment.sessionId)
      if(!session)issues.push({code:'MISSING_SESSION',paymentId:payment.id,detail:'결제 회차 누락'})
      else if(session.ended===null)issues.push({code:'OPEN_PAID_SESSION',paymentId:payment.id,detail:'결제된 회차가 종료되지 않음'})
    }
  }
  return issues
}
