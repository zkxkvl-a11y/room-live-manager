import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const service=readFileSync(new URL('../src/services/cancel-room.ts',import.meta.url),'utf8')
const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8')
test('cancel flow leaves payment ledger untouched and closes session and visits',()=>{
 assert.match(service,/sessions:previous\.sessions\.map/)
 assert.match(service,/visits:previous\.visits\.map/)
 assert.match(service,/started:null,ends:null,tags:\[\]/)
 assert.doesNotMatch(service,/payments:\s*\[/)
 assert.match(service,/진행삭제 · 결제 없이 종료/)
})
test('cancel requires confirmation and uses an atomic transaction',()=>{
 assert.match(app,/confirm\('진행삭제하면 결제 없이 즉시 종료됩니다/)
 assert.match(app,/runTransaction\(target,current=>/)
 assert.match(app,/applyCancelRoom\(previous,id,at,logId\)/)
 assert.match(app,/>진행삭제<\/button>/)
})
