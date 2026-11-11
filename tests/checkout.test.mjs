import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyCheckout } from '../src/services/checkout.ts'

const request={paymentId:'pay-1',roomUid:'room-1',method:'카드',amount:150000,at:2000,manager:'',memo:'',wari:'',wt:''}
function store(){
  return {rooms:[{id:'1T',uid:'room-1',started:1000,ends:3601000,tags:['a']}],tags:['a'],
    attendance:[],shops:[],groups:[],logs:[],visits:[{id:'visit',room:'1T',roomUid:'room-1',tag:'a',entered:1000,exited:null}],
    sessions:[{id:'session',room:'1T',roomUid:'room-1',started:1000,ended:null}],payments:[]}
}
test('checkout atomically closes room, session and visits',()=>{
  const result=applyCheckout(store(),request)
  assert.ok(result)
  assert.equal(result.payments.length,1)
  assert.equal(result.payments[0].sessionId,'session')
  assert.equal(result.rooms[0].started,null)
  assert.equal(result.sessions[0].ended,2000)
  assert.equal(result.visits[0].exited,2000)
})
test('duplicate checkout is rejected without a second payment',()=>{
  const first=applyCheckout(store(),request)
  assert.ok(first)
  assert.equal(applyCheckout(first,request),undefined)
  assert.equal(applyCheckout(first,{...request,paymentId:'pay-2'}),undefined)
})
test('stale session cannot be checked out',()=>{
  const state=store()
  state.sessions[0].started=900
  assert.equal(applyCheckout(state,request),undefined)
})
test('invalid amounts and methods are rejected',()=>{
  for(const amount of [0,-1,1.5,1000000001,Number.NaN])
    assert.equal(applyCheckout(store(),{...request,amount}),undefined)
  assert.equal(applyCheckout(store(),{...request,method:'invalid'}),undefined)
})
test('transaction retry is deterministic and does not mutate input',()=>{
  const source=store()
  const a=applyCheckout(source,request)
  const b=applyCheckout(source,request)
  assert.deepEqual(a,b)
  assert.equal(source.payments.length,0)
})
test('legacy room with no session still checks out',()=>{
  const source=store()
  source.sessions=[]
  const result=applyCheckout(source,request)
  assert.ok(result)
  assert.equal(result.payments[0].sessionId,null)
})

test('checkout logs do not reveal payment amount or method',()=>{
  const result=applyCheckout(store(),request)
  assert.ok(result)
  for(const log of result.logs)assert.doesNotMatch(log.action,/150,000|150000|카드|현금|이체|미수|결제/)
})
test('invalid identifiers and timestamps are rejected',()=>{
  for(const patch of [{paymentId:''},{roomUid:''},{at:-1},{at:1.5}]){
    assert.equal(applyCheckout(store(),{...request,...patch}),undefined)
  }
})
test('overlong ledger input is rejected',()=>{
  for(const patch of [{manager:'a'.repeat(81)},{memo:'a'.repeat(1001)},{wari:'a'.repeat(201)},{wt:'a'.repeat(201)}]){
    assert.equal(applyCheckout(store(),{...request,...patch}),undefined)
  }
})
test('two simultaneous open sessions are rejected',()=>{
  const state=store()
  state.sessions.push({...state.sessions[0],id:'session-2'})
  assert.equal(applyCheckout(state,request),undefined)
})
