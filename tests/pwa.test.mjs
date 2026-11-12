import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
const load=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const manifest=JSON.parse(load('public/manifest.webmanifest'))
test('ROOM LIVE installs as standalone Korean PWA',()=>{
 assert.equal(manifest.name,'ROOM LIVE')
 assert.equal(manifest.display,'standalone')
 assert.equal(manifest.lang,'ko')
 assert.ok(manifest.icons.some(icon=>icon.src==='/room-live-icon.svg'))
})
test('iOS and Android manifest metadata are present',()=>{
 const html=load('index.html')
 for(const value of ['manifest.webmanifest','apple-mobile-web-app-capable','apple-mobile-web-app-title','viewport-fit=cover','theme-color'])assert.ok(html.includes(value))
 assert.ok(html.includes('<html lang="ko">'))
})
test('service worker avoids Firebase data caching and only registers for production',()=>{
 const sw=load('public/sw.js'),entry=load('src/main.tsx')
 assert.match(sw,/request\.method!=='GET'/)
 assert.match(sw,/request\.mode==='navigate'/)
 assert.match(sw,/url\.pathname\.startsWith\('\/assets\/'\)/)
 assert.match(entry,/import\.meta\.env\.PROD/)
 assert.match(entry,/serviceWorker\.register\('\/sw\.js'\)/)
})
