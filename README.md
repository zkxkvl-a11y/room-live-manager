# ROOM LIVE

노래방의 **방 운영·직원 배치·수기 매출 장부**를 관리하는 모바일 중심 웹 앱입니다.

## 제품 범위
- 방 시작·시간 연장·마감, 출퇴근·직원 배치, 실시간 현황
- 수령한 금액과 수단(현금/카드/이체/미수)을 **장부에 기록**
- 관리자 전용 매출 조회·정정·미수금 관리
- Firebase Authentication 및 Realtime Database 사용

**카드 승인, PG, 계좌이체 실행, 결제 대행 기능은 없습니다.**

## 로컬 개발
```bash
npm install
npm run build
npm run lint
npm test
```

## 중요: 아직 운영 전환 금지
현재 main의 레거시 저장 구조와 V2 전환 구조가 공존합니다. V2 checkoutRequests 경로는 Cloud Functions 처리기를 전제로 하므로, Spark 무료 플랜에서 **활성화하면 방 마감이 정상 완료되지 않을 수 있습니다**.

- Firebase `roomLiveV2/config/active`를 임의로 켜지 마세요.
- `database.rules.json`을 운영 DB에 검증 없이 배포하지 마세요.
- Functions 배포 설정이 제거되었다고 기존 배포 함수가 자동 삭제되는 것은 아닙니다.
- 운영 데이터 삭제·마이그레이션·장부 덮어쓰기는 이 저장소의 코드 패치만으로 수행하지 않습니다.
- 직원의 전체 장부 비공개와 방 마감 원자성은 보안 규칙 및 동시성 테스트로 입증해야 합니다.

검증 게이트: [SPARK_CUTOVER_GATE.md](SPARK_CUTOVER_GATE.md)

## 보안
`roomLiveV2/operations`는 직원이 읽을 수 있습니다. 이 경로에는 결제액·결제수단·금전 메모를 저장하면 안 됩니다. 관리자 전용 `finance`와 분리하되, 분리만으로 방 마감의 원자성이나 직원 쓰기 권한 안전성이 보장되지는 않습니다.

## 코드
- `src/App.tsx`: 현재 화면과 Firebase 동기화 로직 (분리 작업 예정)
- `src/store-model.ts`: 데이터 모델 및 레거시 정규화
- `src/services/checkout.ts`: 순수 방 마감 처리
- `src/services/split-store.ts`: 운영/장부 프로젝션
- `database.rules.json`: Firebase RTDB 보안 규칙 (운영 적용 전 검증 필수)
- `functions/`: 이전 서버 결제 요청 처리 코드 (현재 배포 설정에서 제외, 전환 후 제거 예정)
