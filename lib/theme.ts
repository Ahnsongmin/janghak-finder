import type { Benefit, MatchResult } from "./types";

// 결과를 주제(탭)별로 분류 + 관련도 점수 계산.
// 장학금/청년·학생을 가장 위로 올려, 복지로의 방대한 일반복지에 핵심이 묻히지 않게 한다.

export const THEME_ORDER = [
  "장학금",
  "청년·학생",
  "주거",
  "일자리·창업",
  "의료·건강",
  "교육·보육",
  "금융·생활",
  "그 외",
] as const;

export type Theme = (typeof THEME_ORDER)[number];

function haystack(b: Benefit): string {
  return `${b.name} ${b.description ?? ""} ${b.rawConditionText ?? ""}`;
}

export function themeOf(b: Benefit): Theme {
  const t = haystack(b);
  if (b.category === "장학금" || /장학/.test(t)) return "장학금";
  if (b.sourceName.includes("청년") || /청년|대학생|학자금|등록금/.test(t)) return "청년·학생";
  if (/주거|임대|전세|월세|주택|보증금|기숙/.test(t)) return "주거";
  if (/일자리|취업|창업|고용|근로|구직/.test(t)) return "일자리·창업";
  if (/의료|건강|치료|질환|진료|병원|재활|의약|검진/.test(t)) return "의료·건강";
  if (/보육|어린이집|돌봄|보육료|유아|아이돌봄/.test(t)) return "교육·보육";
  if (/금융|대출|바우처|요금|감면|보험료|생계|급여|자금/.test(t)) return "금융·생활";
  return "그 외";
}

/** 관련도 점수: 장학금 > 청년·학생 > 대상가능 > 조건충족 많음 순 */
export function relevanceScore(r: MatchResult): number {
  const b = r.benefit;
  let s = 0;
  // 학과 전용 장학금은 매칭을 통과해야만(=사용자 학과와 일치해야만) 결과에 남는다.
  // 따라서 남아 있다는 건 곧 "내 전공 장학금"이라는 뜻 → 최상단으로.
  if ((b.departments?.length ?? 0) > 0) s += 2000;
  // 계열 전용(이공계 등)도 남아 있으면 내 계열 대상 → 학과 다음 우선순위.
  if ((b.faculties?.length ?? 0) > 0) s += 1500;
  if (b.category === "장학금") s += 1000;
  if (b.sourceName.includes("청년") || /청년|대학생|학자금|장학|등록금/.test(b.name)) s += 500;
  if (r.status === "eligible") s += 100;
  s += r.passed.length * 5 - r.unknown.length * 3;
  return s;
}
