import type { Log, Payment, Store } from '../store-model.ts'
import { normalizeRemote } from '../store-model.ts'
import { applyCheckout, type CheckoutRequest } from './checkout.ts'
import { toOperations } from './split-store.ts'

export type V2Root = {
  operations?:Partial<Store>
  finance?:{payments?:Payment[]|Record<string,Payment>;auditLogs?:Log[]|Record<string,Log>;[key:string]:unknown}
  [key:string]:unknown
}

/** A single RTDB transaction on roomLiveV2. Admin only: worker cannot read finance. */
export function applyV2Checkout(root:V2Root|null,request:CheckoutRequest):V2Root|undefined{
  if(!root?.operations)return
  const finance=root.finance??{}
  const payments=(Array.isArray(finance.payments)?finance.payments:Object.values(finance.payments??{})) as Payment[]
  const previous=normalizeRemote({...root.operations,payments} as Store)
  const next=applyCheckout(previous,request)
  if(!next)return
  return {...root,operations:toOperations(next),finance:{...finance,payments:next.payments}}
}
