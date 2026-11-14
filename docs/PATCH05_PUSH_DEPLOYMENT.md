# PATCH 05 — Cloudflare Workers 알림 서버

## 구현 현황
- `workers/notifications/src/index.js`: Firebase ID 토큰의 Google 공개키 서명·aud·iss·exp 검증
- Firebase 서비스 계정 OAuth 토큰을 이용한 RTDB 권한 조회 및 방 종료 감지
- 인증된 사용자만 구독 등록/삭제, 서버에서 역할 재검증
- D1 구독 저장 및 `INSERT OR IGNORE` 원자적 중복 발송 방지
- 1분 Cron에서 최근 3분 이내 종료된 방 감지, Web Push 발송, 만료 구독 정리
- 전송 실패는 로그에 기록. 중복 방지를 위해 동일 종료 이벤트는 자동 재전송하지 않는 at-most-once 방식
- `public/room-live-sw.js` 서비스 워커와 `src/services/push-client.ts` 구독 클라이언트는 기존 코드에 포함

## 배포 준비 — 수동 작업 필요
1. Cloudflare D1 데이터베이스 `room-live-notifications` 생성 후 `schema.sql` 적용
2. `wrangler.toml`의 D1 바인딩 주석을 풀고 실제 database_id 설정
3. `[triggers]` 아래 `crons = ["* * * * *"]` 활성화
4. Workers Secret에 `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `ADMIN_UID` 설정
5. 일반 변수 `APP_ORIGIN`에 정확한 Cloudflare Pages HTTPS origin 지정
6. 서비스 계정의 최소 RTDB 읽기 권한, D1 및 Cloudflare 비용/무료 한도 검토
7. `workers/notifications`에서 `npm install` 후 `npx wrangler deploy`
8. 앱 측 `subscribePush` 호출은 아직 UI에 연결되지 않았음. Worker URL 및 공개 VAPID 키를 확인한 후 별도 연결 필요

**절대로 서비스 계정 개인키, VAPID 개인키, 구독 endpoint를 GitHub에 올리지 말 것.**
**운영 Firebase Rules/DB는 이 커밋에서 수정하지 않음.**

## 필수 실기기 검증
- 인증 없는 요청 401, 비인가 UID 403, 잘못된 Origin 403
- 로그인 사용자 구독 등록 및 삭제
- 방 종료 시 1회 발송, 같은 종료 시각 중복 발송 0건
- 종료 시각 변경 후 새로운 이벤트로 발송
- 404/410 구독 자동 삭제, 다른 오류 로그 확인
- Android Chrome 백그라운드 수신 및 앱 포커스
- 네트워크 오류, Cron 지연, Cloudflare 무료 사용량 및 권한 변경 시나리오

## 현재 제한
서버 코드와 CI는 추가됐지만 실제 Cloudflare Worker 배포, D1/Secrets 설정, 앱 UI 연결, 실제 푸시 발송 검증은 미완료다. 따라서 PATCH 05는 아직 완료 상태가 아니다.
