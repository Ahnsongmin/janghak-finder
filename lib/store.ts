import type { Benefit } from "./types";
import policiesData from "@/data/policies.json";
import universityScholarships from "@/data/university-scholarships.json";
import nationalScholarships from "@/data/national-scholarships.json";
import foundationScholarships from "@/data/foundation-scholarships.json";
import kosafScholarships from "@/data/kosaf-scholarships.json";
import { SIDO } from "./options";

// 데이터 저장소(MVP): 정규화된 장학금/지원금을 합쳐서 읽는다.
// - policies.json: 정부 공식 API 자동 수집(온통청년/복지로/대학목록). 빌드마다 갱신.
// - national-scholarships.json: 한국장학재단 국가장학금(국가장학Ⅰ·Ⅱ/다자녀/근로/푸른등대/이공계). 전국·전 대학 공통.
// - foundation-scholarships.json: 민간 장학재단(관정·현대차정몽구 등) 정밀매칭 수동 보강분. 전국 단위.
// - kosaf-scholarships.json: 한국장학재단 '학자금지원정보(대학생)' 공공데이터(data.go.kr 15028252).
//   지자체·민간재단·대학·공공기관 장학금 1,850건 종합. 기관명/거주조건에서 시도 추출, 계열 매칭.
// - university-scholarships.json: 대학 공식 페이지에서 수집한 교내장학금(수동 스냅샷, 출처링크 포함).

const SIDO_COUNT = SIDO.length; // 17

/** 17개 시도 전체로 표기된 항목(=전국 정책)을 ["전국"]으로 정리. 매칭 결과는 동일, 표시만 깔끔하게. */
function normalizeRegions(b: Benefit): Benefit {
  const r = b.regions ?? [];
  if (r.length >= SIDO_COUNT && SIDO.every((s) => r.includes(s))) {
    return { ...b, regions: ["전국"] };
  }
  return b;
}

const benefits = [
  ...(nationalScholarships as unknown as Benefit[]),
  ...(foundationScholarships as unknown as Benefit[]),
  ...(kosafScholarships as unknown as Benefit[]),
  ...(policiesData as unknown as Benefit[]),
  ...(universityScholarships as unknown as Benefit[]),
].map(normalizeRegions);

export function getBenefits(): Benefit[] {
  return benefits;
}

const byId = new Map(benefits.map((b) => [b.id, b]));

export function getBenefitById(id: string): Benefit | undefined {
  return byId.get(id);
}

/** 현재 데이터가 예시(데모)만 있는지 — UI 경고 배너 표시에 사용 */
export function isDemoData(): boolean {
  return benefits.length > 0 && benefits.every((b) => b.demo === true);
}

/** 수집된 출처명 목록 (중복 제거) */
export function sourceNames(): string[] {
  return [...new Set(benefits.map((b) => b.sourceName))];
}

/** 가장 최근 수집 시각(ISO) — 데이터 최신성 표기 */
export function lastUpdated(): string | null {
  const times = benefits.map((b) => b.lastFetchedAt).filter((t): t is string => !!t);
  return times.length ? times.sort().at(-1)! : null;
}
