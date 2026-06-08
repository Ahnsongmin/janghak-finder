// 장학금·지원금 1건의 "통합 스키마".
// 모든 출처(온통청년/복지로/대학알리미/한국장학재단)의 원본 데이터를 이 형태로 정규화한다.
// 핵심 원칙: 값은 출처에서 온 팩트만. 알 수 없는 조건은 null/빈배열로 두고 절대 추측하지 않는다.

export type BenefitCategory = "장학금" | "지원금" | "대출" | "기타";

export interface Benefit {
  /** 출처 내 고유 ID와 충돌하지 않도록 "source:원본ID" 형태로 만든다 */
  id: string;
  name: string;
  category: BenefitCategory;
  /** 주관/운영 기관 */
  provider: string;
  /** 데이터 출처명 (예: 온통청년, 한국장학재단) — 결과 카드에 항상 표기 */
  sourceName: string;
  description?: string;

  // ── 구조화된 자격조건 (매칭에 사용) ──
  /** 거주지역: ["전국"] 또는 시도명 배열. 빈 배열이면 미상(=조건확인) */
  regions: string[];
  /** 소득분위 상한(이하)이면 그 값. null = 무관/미상(incomeNote 참고) */
  incomeMax: number | null;
  /** 소득 조건 원문 (분위로 환산 불가한 경우 여기에 둔다) */
  incomeNote?: string;
  ageMin: number | null;
  ageMax: number | null;
  /** 학력/재학상태 요건. 빈 배열이면 무관/미상 */
  eduStatus: string[];
  /** 해당 학년. 빈 배열이면 무관/미상 */
  grades: number[];
  /** 요구되는 특수자격(모두 충족해야 함, AND). 빈 배열이면 무관 */
  requiredFlags: string[];
  /** 대상 집단(이 중 하나라도 해당하면 대상, OR). 빈 배열이면 무관.
   *  복지로 '대상특성'(장애인/한부모/다자녀 등)처럼 "여러 대상군 중 하나" 조건에 사용 */
  targetGroups: string[];
  /** 특정 대학 전용 교내장학금이면 그 대학명(universities.json 표기와 일치).
   *  설정 시, 사용자가 그 대학을 선택했을 때만 노출 */
  university?: string;

  // ── 표시/근거용 (매칭엔 안 쓰지만 사용자 검증에 필수) ──
  amount?: string;
  applyPeriod?: string;
  applyMethod?: string;
  submitDocs?: string;
  applyUrl?: string;
  refUrls?: string[];
  /** 출처 원문 조건 텍스트 — "거짓 없음" 보장을 위해 그대로 보존 */
  rawConditionText?: string;
  /** ISO 문자열. 데이터 최신성 표기용 */
  lastFetchedAt?: string;
  /** 예시(데모) 데이터 여부. true면 UI에서 "예시"로 명확히 표시 */
  demo?: boolean;
}

/** 사용자가 입력하는 프로필 */
export interface UserProfile {
  /** 시도명. "" 이면 미선택 */
  region: string;
  /** 소득분위 1~10. 0 = 모름/미선택 */
  income: number;
  age?: number;
  /** 재학/학력 상태 (대학생, 대학원생 등). "" 이면 미선택 */
  eduStatus: string;
  /** 학년 1~4(+). 0 = 모름/미선택 */
  grade: number;
  /** 선택한 대학명. "" 이면 미선택 */
  univ: string;
  /** 보유 특수자격 플래그 */
  flags: string[];
}

export type MatchStatus = "eligible" | "review" | "excluded";

export interface MatchResult {
  benefit: Benefit;
  status: MatchStatus;
  /** 충족된 조건 설명 */
  passed: string[];
  /** 정보 부족으로 확인 필요한 조건 */
  unknown: string[];
  /** 불충족 사유 (excluded일 때) */
  failed: string[];
}
