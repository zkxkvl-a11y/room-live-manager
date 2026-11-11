import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
const rules=JSON.parse(readFileSync(new URL('../database.rules.json',import.meta.url),'utf8')).rules
test('legacy full ledger never grants staff access',()=>{
  assert.doesNotMatch(rules.roomLive['.read'],/staff|worker/)
  assert.doesNotMatch(rules.roomLive['.write'],/staff|worker/)
})
test('finance is administrator-only',()=>{
  assert.doesNotMatch(rules.roomLiveV2.finance['.read'],/staff|worker/)
  assert.doesNotMatch(rules.roomLiveV2.finance['.write'],/staff|worker/)
})
test('worker operations cannot contain finance nodes',()=>{
  const rule=rules.roomLiveV2.operations['.validate']
  assert.match(rule,/payments/)
  assert.match(rule,/finance/)
})
test('checkout requests are create-only and owned by caller',()=>{
  const rule=rules.roomLiveV2.checkoutRequests['$requestId']
  assert.match(rule['.write'],/!data.exists\(\)/)
  assert.match(rule['.validate'],/auth.uid/)
  assert.ok(rule['$other'])
})
