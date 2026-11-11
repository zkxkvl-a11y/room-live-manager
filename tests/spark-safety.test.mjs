import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules
const firebase = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'))

test('client must not submit orphaned V2 checkout requests', () => {
  assert.doesNotMatch(app, /CHECKOUT_PATH|checkoutRequests\//)
  assert.match(app, /V2 장부 전환이 아직 검증되지 않았습니다/)
  assert.match(app, /runTransaction\(roomLiveRef,current=>/)
})

test('Functions deployment is absent from Spark configuration', () => {
  assert.equal(Object.hasOwn(firebase, 'functions'), false)
})

test('legacy roomLive ledger is admin-only in deployed rules source', () => {
  assert.match(rules.roomLive['.read'], /auth\.uid ===/)
  assert.equal(rules.roomLive['.read'], rules.roomLive['.write'])
  assert.doesNotMatch(rules.roomLive['.read'], /roomLiveAccess/)
})

test('finance read and write paths are admin-only', () => {
  const finance = rules.roomLiveV2.finance
  assert.equal(finance['.read'], finance['.write'])
  assert.doesNotMatch(finance['.read'], /roomLiveAccess|worker|staff|observer/)
})

test('observer has no operations or finance access', () => {
  assert.doesNotMatch(rules.roomLiveV2.operations['.read'], /observer/)
  assert.doesNotMatch(rules.roomLiveV2.finance['.read'], /observer/)
})

test('V2 cutover remains gated; static assertions do not substitute for emulator tests', () => {
  const gate = readFileSync(new URL('../SPARK_CUTOVER_GATE.md', import.meta.url), 'utf8')
  assert.match(gate, /전환 금지/)
  assert.match(gate, /에뮬레이터/)
})
