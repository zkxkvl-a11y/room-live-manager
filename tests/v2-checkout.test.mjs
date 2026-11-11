import assert from 'node:assert/strict'
import {test} from 'node:test'
import {applyV2Checkout} from '../src/services/v2-checkout.ts'

const request={paymentId:'payment-1',roomUid:'room-1',method:'카드',amount:150000,at:2000,manager:'',memo:'',wari:'',wt:''}
function root(){
 return {
  config:{active:true},
  workerView:{updatedAt:1},
  operations:{
   rooms:[{id:'1T',uid:'room-1',started:1000,ends:3601000,tags:['a']}],
   tags:['a'],attendance:[],shops:[],groups:[],logs:[],
   visits:[{id:'visit',room:'1T',roomUid:'room-1',tag:'a',entered:1000,exited:null}],
   sessions:[{id:'session',room:'1T',roomUid:'room-1',started:1000,ended:null}]
  },
  finance:{payments:[],auditLogs:[{id:'audit-1',at:10,room:'1T',action:'정정'}]}
 }
}
test('admin V2 checkout closes operations and adds finance payment together',()=>{
 const original=root()
 const next=applyV2Checkout(original,request)
 assert.ok(next)
 assert.equal(next.operations.rooms[0].started,null)
 assert.equal(next.operations.sessions[0].ended,2000)
 assert.equal(next.operations.visits[0].exited,2000)
 assert.equal(next.finance.payments[0].amount,150000)
 assert.equal(Object.hasOwn(next.operations,'payments'),false)
 assert.deepEqual(next.finance.auditLogs,original.finance.auditLogs)
 assert.deepEqual(next.config,original.config)
 assert.deepEqual(next.workerView,original.workerView)
 assert.equal(original.operations.rooms[0].started,1000)
})
test('V2 checkout rejects duplicate or stale transactions',()=>{
 const first=applyV2Checkout(root(),request)
 assert.ok(first)
 assert.equal(applyV2Checkout(first,request),undefined)
 assert.equal(applyV2Checkout(first,{...request,paymentId:'payment-2'}),undefined)
})
test('V2 checkout rejects invalid requests without mutating root',()=>{
 const original=root(),before=structuredClone(original)
 assert.equal(applyV2Checkout(original,{...request,amount:0}),undefined)
 assert.deepEqual(original,before)
 assert.equal(applyV2Checkout({finance:{payments:[]}},request),undefined)
})
test('V2 checkout accepts Firebase object-map payment storage',()=>{
 const original=root()
 original.finance.payments={'previous':{id:'previous',room:'2T',roomUid:'room-2',at:1,amount:100,method:'현금',sessionId:null}}
 const next=applyV2Checkout(original,request)
 assert.ok(next)
 assert.equal(next.finance.payments.length,2)
})
