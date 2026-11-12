import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
const rules=JSON.parse(readFileSync(new URL('../database.rules.json',import.meta.url),'utf8')).rules
const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8')
test('MVP legacy roomLive permits approved workers and staff',()=>{
 for(const key of ['.read','.write']){
  assert.match(rules.roomLive[key],/roomLiveAccess/)
  assert.match(rules.roomLive[key],/worker/)
  assert.match(rules.roomLive[key],/staff/)
  assert.doesNotMatch(rules.roomLive[key],/observer/)
 }
})
test('MVP protects shared root against deletion and empty store writes',()=>{
 assert.match(rules.roomLive['.write'],/newData.exists\(\)/)
 assert.match(rules.roomLive['.write'],/newData.hasChild\('rooms'\)/)
 assert.match(rules.roomLive['.write'],/newData.hasChild\('payments'\)/)
})
test('only admins can approve staff and initialize server',()=>{
 assert.match(app,/async function addStaff\(\)\{\s*if\(!isAdmin\)return/)
 assert.match(app,/async function importLocal\(\)\{\s*if\(!isAdmin\)return/)
 assert.match(app,/remoteState==='empty'&&isAdmin&&/)
})
test('legacy checkout uses transaction to store room closure and sale',()=>{
 assert.match(app,/runTransaction\(roomLiveRef,current=>/)
 assert.match(app,/applyCheckout\(previous,\{paymentId,roomUid,method,amount,at,manager,memo,wari,wt\}\)/)
})
