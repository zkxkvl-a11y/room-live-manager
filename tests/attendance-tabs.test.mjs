import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8')
const model=readFileSync(new URL('../src/store-model.ts',import.meta.url),'utf8')
test('attendance groups keep an all tab and custom tabs',()=>{
 assert.match(app,/attendanceTab==='all'/)
 assert.match(app,/>전체<\/button>/)
 assert.match(app,/>\+ 탭 추가<\/button>/)
 assert.match(app,/attendanceTeams\.map\(team=>/)
})
test('attendance membership persists without deleting staff',()=>{
 assert.match(model,/teamId\?:string/)
 assert.match(model,/attendanceTeams\?:AttendanceTeam\[\]/)
 assert.match(model,/attendanceTeams:array<AttendanceTeam>/)
 assert.match(app,/teamId:e\.target\.value/)
 assert.match(app,/소속 인원은 삭제되지 않고 미분류로 이동/)
})
