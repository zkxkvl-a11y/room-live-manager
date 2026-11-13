# ROOM LIVE 백그라운드 종료 알림

이 폴더는 Firebase Cloud Functions 예약 발송 서버입니다. **Cloudflare Pages 배포만으로 자동 실행되지 않습니다.**

## 배포 준비
1. Firebase 프로젝트 `room-live-manager`를 Blaze 요금제로 전환하고 Cloud Functions 및 Cloud Scheduler를 활성화합니다.
2. `npm install`을 이 폴더에서 실행합니다.
3. `npx web-push generate-vapid-keys`로 VAPID 키 쌍을 생성합니다.
4. Firebase Functions secrets에 `ROOM_LIVE_VAPID_PRIVATE`, `ROOM_LIVE_VAPID_PUBLIC`, `ROOM_LIVE_VAPID_CONTACT`(예: mailto:admin@example.com)를 설정합니다.
5. Cloudflare Pages 빌드 환경변수 `VITE_WEB_PUSH_PUBLIC_KEY`에 **동일한 공개키**를 설정하고 재배포합니다.
6. Firebase Realtime Database 보안 규칙에서 `roomLivePushSubscriptions/$uid`는 로그인 사용자 본인에게만 읽기/쓰기를 허용합니다. 다른 사용자의 구독정보 조회는 차단해야 합니다.
7. Firebase CLI에서 `firebase deploy --only functions:roomDeadlinePush --project room-live-manager`로 발송 함수를 배포합니다. Firebase CLI 설정 및 권한이 필요합니다.
8. Android Chrome / iOS 16.4+ 홈 화면 PWA에서 알림 권한 허용 및 실제 수신을 검증합니다.

## 제한
예약 실행은 1분 단위이므로 수십 초 지연될 수 있습니다. 네트워크, 절전모드, OS 정책에 따라 전달은 보장되지 않습니다.
구독 등록은 사용자별 기기별로 저장됩니다. 사용자가 설정을 변경하면 갱신합니다.
