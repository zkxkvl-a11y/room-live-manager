import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mergeSplit, toOperations, toFinance } from '../src/services/split-store.ts'

function fixture(){
  return {
    rooms:[{id:'1T',uid:'r1',started:null,ends:null,tags:[]}],
    tags:[],attendance:[],visits:[],sessions:[],
    logs:[
      {id:'l1',at:1,room:'1T',action:'방 시작 · 60분'},
      {id:'l2',at:2,room:'1T',action:'관리자 장부 정정 · 카드 100원'},
    ],
    payments:[{id:'p1',room:'1T',at:2,amount:100,method:'카드',sessionId:null}],
  }
}
test('worker operations never include payments',()=>{
  const ops=toOperations(fixture())
  assert.equal(Object.hasOwn(ops,'payments'),false)
  assert.equal(Object.hasOwn(ops,'finance'),false)
  assert.equal(ops.logs.length,1)
  assert.equal(ops.logs[0].id,'l1')
})
test('admin can merge the operations and finance projections',()=>{
  const source=fixture()
  const ops=toOperations(source)
  const finance=toFinance(source)
  const restored=mergeSplit(ops,finance)
  assert.equal(restored.payments[0].id,'p1')
  assert.equal(restored.rooms[0].uid,'r1')
})
test('worker projection never gains payments when finance is unavailable',()=>{
  const result=mergeSplit(toOperations(fixture()),null)
  assert.deepEqual(result.payments,[])
})
