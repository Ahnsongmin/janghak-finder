import type { Benefit } from "./types";
import policiesData from "@/data/policies.json";

// 데이터 저장소(MVP): 정규화된 장학금/지원금을 data/policies.json 에서 읽는다.
// - 실데이터는 scripts/ingest.mjs 가 정부 공식 API에서 수집해 이 파일을 덮어쓴다.
// - 아직 수집 전(키 미설정)이면 demo:true 예시 데이터만 들어 있다.
// 후속(Phase 2): Postgres/KV + Vercel Cron 으로 교체해 런타임 자동 최신화.

const benefits = policiesData as unknown as Benefit[];

export function getBenefits(): Benefit[] {
  return benefits;
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
