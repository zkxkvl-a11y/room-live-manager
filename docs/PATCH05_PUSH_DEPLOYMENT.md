# PATCH 05 — Cloudflare Workers 알림 연동 체크리스트

## 안전한 단계별 도입
1. Web Push 공개 VAPID 키와 Cloudflare Worker HTTPS URL을 준비한다.
2. Worker는 Firebase ID 토큰의 서명·발급자·대상 프로젝트·만료 시간을 검증한다.
3. Worker는 인증된 사용자 UID에 대해서만 구독을 등록·삭제한다. 옵저버/실무자/관리자 권한은 서버에서 재확인한다.
4. 구독 endpoint 및 p256dh/auth 키는 서버에만 저장하고 공개 Firebase 경로에 노출하지 않는다.
5. Workers Cron은 서버 측 방 종료 시간을 조회하고, 중복 방지 키(room UID + end timestamp)를 원자적으로 기록한 뒤 알림을 발송한다.
6. 기기별 알림 수신, 재시도, 중복 발송, 권한 거부, 구독 만료, 백그라운드 동작을 검증한다.

## 현재 구현 범위
- 알림 전용 서비스 워커의 수신·클릭 처리.
- 브라우저 지원 확인, 사용자 권한 요청, VAPID 구독 및 인증 토큰 전송 클라이언트.
- 아직 Workers 서버, Firebase 서비스 계정 인증, Web Push 암호화/발송 및 Cron은 구현되지 않았다.
- 따라서 현재 단계에서 서버 URL/공개키를 설정하거나 실제 운영 알림을 활성화하지 않는다.
- 운영 DB 및 Firebase Rules 변경 없음.

## 필요한 운영 준비
Cloudflare Worker 배포 권한, Worker URL, VAPID 공개/비공개 키, Firebase 서비스 계정 자격증명(Workers Secret), 구독 저장소 및 권한 규칙 검토. **비밀키를 GitHub에 커밋하지 말 것.**
