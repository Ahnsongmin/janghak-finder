import type { Benefit } from "./types";

// 지원(모집)기간 상태 판정.
// applyPeriod 형식은 주로 "YYYYMMDD ~ YYYYMMDD" (온통청년). 한쪽만 있거나 없을 수 있다.
//   open     : 모집 중 (지금 지원 가능)
//   upcoming : 시작 전 (곧 열림)
//   closed   : 마감 (결과에서 제외)
//   always   : 날짜 정보 없음 (상시/수시/직전회차 — 숨기지 않고 '날짜 확인'으로 안내)
// 비교는 '날짜(연월일)' 단위. 시각·타임존 영향을 줄이기 위해 자정 기준으로 자른다.

export type ApplyState = "open" | "upcoming" | "closed" | "always";

export interface ApplyInfo {
  state: ApplyState;
  start: Date | null;
  end: Date | null;
}

function ymd(s: string): Date | null {
  const t = s.trim();
  if (!/^\d{8}$/.test(t)) return null;
  const y = +t.slice(0, 4);
  const m = +t.slice(4, 6);
  const d = +t.slice(6, 8);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return new Date(y, m - 1, d);
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function applyStatus(b: Benefit, now: Date = new Date()): ApplyInfo {
  const p = b.applyPeriod?.trim();
  if (!p) return { state: "always", start: null, end: null };

  const segs = p.split("~");
  const start = segs[0] ? ymd(segs[0]) : null;
  const end = segs[1] ? ymd(segs[1]) : null;
  if (!start && !end) return { state: "always", start: null, end: null };

  const today = startOfDay(now);
  if (end && today > startOfDay(end)) return { state: "closed", start, end };
  if (start && today < startOfDay(start)) return { state: "upcoming", start, end };
  return { state: "open", start, end };
}

/** "6/24" 형식 */
export function fmtMD(d: Date | null): string {
  if (!d) return "";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 마감까지 남은 일수(end 기준). end 없으면 null. 음수면 지남. */
export function daysLeft(end: Date | null, now: Date = new Date()): number | null {
  if (!end) return null;
  return Math.round((startOfDay(end) - startOfDay(now)) / 86400000);
}
