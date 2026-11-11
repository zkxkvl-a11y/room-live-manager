import type { Store } from '../store-model'

export const OPERATIONS_PATH='roomLiveV2/operations'
export const FINANCE_PATH='roomLiveV2/finance'
// Explicit allowlist: an unknown or future log type must never leak financial notes to workers.
const operationalLog=(action:string)=>
  /^(?:방 시작|방 마감|첫 입실|시간 |.+ 퇴실|.+ 입실|.+ 배치|.+ 이동|.+ 출근|.+ 퇴근)/.test(action)
  && !/결제|장부|미수|매출|수금|정정|금액|현금|카드|이체|와리|WT|\d[\d,]*원/.test(action)
export function toOperations(store:Store){
  // Never spread the source Store into a worker-readable location.
  // Newly introduced fields must be reviewed and explicitly allowlisted.
  return {
    rooms:store.rooms,
    tags:store.tags,
    attendance:store.attendance,
    logs:store.logs.filter(log=>operationalLog(log.action)),
    visits:store.visits,
    sessions:store.sessions,
    layout:store.layout,
    shops:store.shops,
    groups:store.groups,
    showWari:store.showWari,
    showWt:store.showWt
  }
}
export function toFinance(store:Store){
  return {payments:store.payments}
}
export function mergeSplit(operations:Partial<Store>|null,finance:{payments?:Store['payments']}|null):Store|null{
  if(!operations)return null
  return {...operations,payments:finance?.payments??[]} as Store
}
