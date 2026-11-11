import type { Store } from '../store-model'

export const OPERATIONS_PATH='roomLiveV2/operations'
export const FINANCE_PATH='roomLiveV2/finance'
export const CHECKOUT_PATH='roomLiveV2/checkoutRequests'

const financeLog=(action:string)=>/결제|장부|미수|매출|수금|정정|금액|현금|카드|이체|와리|WT|원 →|원 ·/.test(action)
export function toOperations(store:Store){
  const {payments: _payments,...rest}=store
  void _payments
  return {...rest,logs:store.logs.filter(log=>!financeLog(log.action))}
}
export function toFinance(store:Store){
  return {payments:store.payments}
}
export function mergeSplit(operations:Partial<Store>|null,finance:{payments?:Store['payments']}|null):Store|null{
  if(!operations)return null
  return {...operations,payments:finance?.payments??[]} as Store
}
