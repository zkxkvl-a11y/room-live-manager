import assert from 'node:assert/strict'
import {test} from 'node:test'
import {auditLedger} from '../src/services/ledger-audit.ts'

function store(){
 return {
   rooms:[{id:'1T',uid:'r1',started:null,ends:null,tags:[]}],
   sessions:[{id:'s1',room:'1T',roomUid:'r1',started:1,ended:20}],
   payments:[{id:'p1',room:'1T',roomUid:'r1',sessionId:'s1',at:20,amount:100,method:'현금'}],
   tags:[],logs:[],visits:[]
 }
}
test('valid closed ledger has no reconciliation findings',()=>assert.deepEqual(auditLedger(store()),[]))
test('duplicate IDs and session charges are both reported',()=>{
 const s=store()
 s.payments.push({...s.payments[0],id:'p2'})
 s.payments.push({...s.payments[0]})
 const codes=auditLedger(s).map(i=>i.code)
 assert.ok(codes.includes('DUPLICATE_ID'))
 assert.ok(codes.includes('DUPLICATE_SESSION'))
})
test('missing rooms, invalid amounts and open paid sessions are reported',()=>{
 const s=store()
 s.payments[0].roomUid='deleted'
 s.payments[0].amount=-1
 s.sessions[0].ended=null
 const codes=auditLedger(s).map(i=>i.code)
 for(const code of ['MISSING_ROOM','INVALID_AMOUNT','OPEN_PAID_SESSION'])assert.ok(codes.includes(code))
})
test('missing session is reported without changing original data',()=>{
 const s=store()
 s.sessions=[]
 const before=structuredClone(s)
 assert.ok(auditLedger(s).some(i=>i.code==='MISSING_SESSION'))
 assert.deepEqual(s,before)
})
