# ROOM LIVE Android + iPhone 공용 PWA 테스트 배포

## 배포 전제
- 이 브랜치 `patch/multi-user-mvp`를 사용합니다. 기존 `main`은 그대로 유지합니다.
- 앱은 HTTPS 도메인에서 서비스해야 설치할 수 있습니다. StackBlitz 편집/미리보기 주소를 직원용 운영 주소로 사용하지 마세요.
- Firebase RTDB 규칙(`database.rules.json`)은 **GitHub 변경만으로 배포되지 않습니다**. 별도 테스트 프로젝트에서 백업·권한 확인 후 적용하세요.
- Firebase Authentication > Settings > Authorized domains에 배포 도메인을 추가하고, 이메일/비밀번호 로그인을 활성화합니다.
- `roomLiveV2/config/active`는 `false`로 유지합니다.

## 무료 배포: Firebase Hosting (Spark)
1. 개발 환경에서 `npm ci && npm test && npm run build` 실행
2. Firebase CLI 설치 및 로그인: `npm install -g firebase-tools`, `firebase login`
3. 테스트 Firebase 프로젝트 선택: `firebase use --add` (프로젝트를 명확히 확인)
4. `firebase init hosting`: public directory는 `dist`, single-page app은 **Yes**, GitHub 자동 배포는 필요할 때만 설정. 기존 `index.html` 덮어쓰기 질문에는 **No**
5. `npm run build && firebase deploy --only hosting --project <TEST_PROJECT_ID>`
6. 배포 URL에서 로그인·방 시작·마감·동기화 시험. 기존 운영 프로젝트에 바로 배포하지 마세요.

## 직원 설치 방법
- **Android**: Chrome에서 배포 URL 열기 → 메뉴 → '앱 설치' 또는 '홈 화면에 추가'
- **iPhone**: Safari에서 배포 URL 열기 → 공유 → '홈 화면에 추가' → 추가
- 기기/브라우저 버전에 따라 설치 메뉴가 다릅니다. iOS에서 SVG 아이콘 지원이 제한되면 홈 화면 아이콘이 기본 이미지로 표시될 수 있습니다.

## 테스트 체크
1. 관리자와 직원이 다른 기기로 로그인
2. 관리자 계정에서 직원 UID를 worker로 승인
3. 방 시작 → 다른 휴대폰에 즉시 반영
4. 직원이 수기 매출 등록 후 마감 → 관리자 장부 확인
5. 다른 기기에서 중복 마감 방지 확인
6. 새 버전 배포 → 앱 재실행 후 최신 화면 확인
7. 오프라인에서 앱이 거래를 저장했다고 오해하지 않도록 확인 (인터넷 필요)

## 주의
- 이 MVP는 승인된 직원이 `roomLive`의 **전체 장부를 데이터베이스 수준에서 읽고 수정할 수 있는 내부 테스트용 구조**입니다. 신뢰할 수 있는 직원과 가상 매출로 먼저 검증하세요.
- PWA는 네이티브 앱이 아니며, iOS에서는 홈 화면 추가가 필요합니다.
- SVG 아이콘은 포함했지만 PNG 192/512 및 Apple touch icon은 아직 포함하지 않았습니다. 일부 Android 설치 UI나 iOS 아이콘 표시가 제한될 수 있어 배포 후 실제 기기 확인이 필요합니다.
- 로그인·실시간 동기화는 인터넷이 필요합니다. 오프라인 매출 저장은 지원하지 않습니다.
