# 장학금·지원금 찾기 (janghak-finder)

주소(시·도)·소득분위·나이·재학상태·특수자격 몇 가지만 입력하면, 받을 수 있는 **장학금·지원금 목록 + 신청 조건 + 공식 신청 링크**를 모아 보여주는 웹앱입니다.

## 핵심 원칙 — 거짓·누락 없음

장학금/지원금 데이터는 **사람이 외워서 적지 않습니다.** (그 방식이 오류·노후화·누락의 원인.)
대신 **정부 공식 공개 API**에서 자동 수집·정규화합니다. 모든 결과 카드에는 **출처명·원문 조건·공식 링크·수집일시**가 함께 표시되어 사용자가 직접 검증할 수 있습니다.

> 현재 저장소에는 API 키 연결 전 동작을 보여주기 위한 **예시(demo) 데이터**만 들어 있습니다. 결과 화면 상단과 각 카드에 "예시 데이터"로 명확히 표시됩니다.

## 구조

```
app/page.tsx            입력 폼 (클라이언트)
app/results/page.tsx    매칭 결과 (서버 컴포넌트)
app/components/         결과 카드
lib/types.ts            통합 스키마(Benefit/UserProfile/MatchResult)
lib/options.ts          시도·소득구간·특수자격 등 선택지 + 법정동코드→시도 매핑
lib/match.ts            매칭 엔진 (pass/fail/unknown 3-state)
lib/store.ts            data/policies.json 로더
lib/sources/*.ts        출처별 수집 어댑터 (현재: 온통청년)
scripts/ingest.ts       공식 API → data/policies.json 수집
scripts/inspect-*.ts    API 응답 필드 검증용
data/policies.json      정규화된 데이터 (현재 예시)
```

## 실데이터 채우기

1. 온통청년 API 키 발급: <https://www.youthcenter.go.kr> 로그인 → 마이페이지 → 오픈(OPEN) API 신청
2. `.env.example` → `.env.local` 복사 후 `YOUTHCENTER_API_KEY` 입력
3. 응답 필드 확인(어댑터 매핑 검증): `npm run inspect:youth`
4. 수집 실행: `npm run ingest` → `data/policies.json` 갱신
5. `npm run dev` 또는 재배포

## 개발

```bash
npm run dev      # 개발 서버
npm run build    # 프로덕션 빌드
npm run ingest   # 공식 API 수집 (키 필요)
```

## 로드맵

- [x] 검색·매칭 MVP (온통청년 어댑터 + 매칭 엔진 + UI)
- [ ] 출처 확장: 복지로/보조금24, 대학알리미(전국 대학+교내장학), 한국장학재단
- [ ] Postgres/KV + Vercel Cron 자동 최신화
- [ ] (유료) AI 신청서 작성 — 양식에 맞춰 채운 PDF/문서 출력 (제출은 사용자 본인)
