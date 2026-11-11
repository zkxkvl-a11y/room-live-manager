import type { Store } from '../store-model'

export const OPERATIONS_PATH='roomLiveV2/operations'
export const FINANCE_PATH='roomLiveV2/finance'
export const CHECKOUT_PATH='roomLiveV2/checkoutRequests'

const financeLog=(action:string)=>action.includes('결제')||action.includes('장부')||action.includes('미수')||action.includes('원 →')||action.includes('원 ·')
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
