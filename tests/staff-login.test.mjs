import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8')
const helper=readFileSync(new URL('../src/staff-login.ts',import.meta.url),'utf8')
test('staff login accepts ID alias and keeps admin email login',()=>{
 assert.match(app,/loginEmailFromInput\(loginId\)/)
 assert.match(app,/아이디 또는 관리자 이메일/)
 assert.match(helper,/value\.includes\('@'\)/)
 assert.match(helper,/return staffEmailFromId\(value\)/)
})
test('staff ID format and domain are stable',()=>{
 assert.match(helper,/roomlive\.invalid/)
 assert.match(helper,/\[a-z0-9_-\]/)
 assert.match(helper,/\.toLowerCase\(\)/)
})
