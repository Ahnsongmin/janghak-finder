"use client";

import { useMemo, useState } from "react";
import type { MatchResult } from "@/lib/types";
import { THEME_ORDER, themeOf, relevanceScore, type Theme } from "@/lib/theme";
import { applyStatus, type ApplyInfo } from "@/lib/apply-status";
import { ResultCard } from "./result-card";

const PAGE = 20;
const RECOMMEND = "추천";
const ALL = "전체";

type SortOrder = "relevance" | "amount-desc" | "amount-asc" | "deadline" | "start";
type StateFilter = "all" | "open" | "upcoming" | "always";

/** amount 텍스트에서 최대 금액(원)을 파싱. 정렬 전용 — 실제 표시엔 원문 그대로 사용. */
function parseMaxAmount(amount?: string): number {
  if (!amount) return 0;
  if (/전액/.test(amount)) return 8_000_000;
  const manMatches = [...amount.matchAll(/(\d[\d,]*)\s*만\s*원/g)];
  const manVals = manMatches.map((m) => parseInt(m[1].replace(/,/g, ""), 10) * 10_000);
  const wonMatches = [...amount.matchAll(/(\d[\d,]{3,})\s*원/g)];
  const wonVals = wonMatches.map((m) => parseInt(m[1].replace(/,/g, ""), 10));
  const all = [...manVals, ...wonVals];
  return all.length > 0 ? Math.max(...all) : 0;
}

function applySort(
  list: MatchResult[],
  order: SortOrder,
  statusOf: Map<string, ApplyInfo>,
): MatchResult[] {
  if (order === "relevance") return list; // 이미 관련도순
  if (order === "deadline") {
    // 마감일(end) 가까운 순. end 없는 항목은 뒤로.
    return [...list].sort((a, b) => {
      const ea = statusOf.get(a.benefit.id)?.end ?? null;
      const eb = statusOf.get(b.benefit.id)?.end ?? null;
      if (ea && eb) return ea.getTime() - eb.getTime();
      if (ea) return -1;
      if (eb) return 1;
      return 0;
    });
  }
  if (order === "start") {
    // 모집 시작일 이른 순. start 없는(날짜 미상) 항목은 뒤로.
    return [...list].sort((a, b) => {
      const sa = statusOf.get(a.benefit.id)?.start ?? null;
      const sb = statusOf.get(b.benefit.id)?.start ?? null;
      if (sa && sb) return sa.getTime() - sb.getTime();
      if (sa) return -1;
      if (sb) return 1;
      return 0;
    });
  }
  return [...list].sort((a, b) => {
    const va = parseMaxAmount(a.benefit.amount);
    const vb = parseMaxAmount(b.benefit.amount);
    return order === "amount-desc" ? vb - va : va - vb;
  });
}

const SORT_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: "relevance", label: "관련도순" },
  { value: "start", label: "시작일순" },
  { value: "deadline", label: "마감임박순" },
  { value: "amount-desc", label: "금액 높은순" },
  { value: "amount-asc", label: "금액 낮은순" },
];

const STATE_FILTERS: { value: StateFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "open", label: "지금 지원 가능" },
  { value: "upcoming", label: "곧 열림" },
  { value: "always", label: "상시·모집기간 모름" },
];

export function ResultsView({ results }: { results: MatchResult[] }) {
  const [sortOrder, setSortOrder] = useState<SortOrder>("relevance");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");

  // 각 항목의 지원기간 상태(1회 계산). now는 렌더 동안 고정.
  const { statusOf, openResults, closedCount } = useMemo(() => {
    const now = new Date();
    const map = new Map<string, ApplyInfo>();
    for (const r of results) map.set(r.benefit.id, applyStatus(r.benefit, now));
    // 마감(closed)은 결과에서 제외
    const open = results.filter((r) => map.get(r.benefit.id)!.state !== "closed");
    return { statusOf: map, openResults: open, closedCount: results.length - open.length };
  }, [results]);

  // 주제별 버킷 + 관련도순 정렬 (마감 제외분 기준)
  const { tabs, byTab } = useMemo(() => {
    const sorted = [...openResults].sort((a, b) => relevanceScore(b) - relevanceScore(a));
    const buckets = new Map<string, MatchResult[]>();
    for (const r of sorted) {
      const th = themeOf(r.benefit);
      (buckets.get(th) ?? buckets.set(th, []).get(th)!).push(r);
    }
    const recommend = sorted.filter((r) => {
      const th = themeOf(r.benefit);
      return th === "장학금" || th === "청년·학생";
    });

    const themeTabs = THEME_ORDER.filter((t) => (buckets.get(t)?.length ?? 0) > 0) as Theme[];
    const map = new Map<string, MatchResult[]>(buckets);
    if (recommend.length) map.set(RECOMMEND, recommend);
    map.set(ALL, sorted);

    const tabList = [...(recommend.length ? [RECOMMEND] : []), ...themeTabs, ALL];
    return { tabs: tabList, byTab: map };
  }, [openResults]);

  const [active, setActive] = useState(tabs[0] ?? ALL);
  const [limit, setLimit] = useState(PAGE);

  const baseList = useMemo(() => byTab.get(active) ?? [], [byTab, active]);
  // 현재 탭에서 지원기간 상태별 개수 (필터 버튼 카운트용)
  const counts = useMemo(() => {
    let open = 0;
    let upcoming = 0;
    let always = 0;
    for (const r of baseList) {
      const s = statusOf.get(r.benefit.id)!.state;
      if (s === "open") open++;
      else if (s === "upcoming") upcoming++;
      else if (s === "always") always++;
    }
    return { all: baseList.length, open, upcoming, always };
  }, [baseList, statusOf]);

  const list = useMemo(() => {
    const filtered =
      stateFilter === "all"
        ? baseList
        : baseList.filter((r) => statusOf.get(r.benefit.id)!.state === stateFilter);
    return applySort(filtered, sortOrder, statusOf);
  }, [baseList, stateFilter, sortOrder, statusOf]);

  const shown = list.slice(0, limit);

  function selectTab(t: string) {
    setActive(t);
    setLimit(PAGE);
  }
  function changeSort(order: SortOrder) {
    setSortOrder(order);
    setLimit(PAGE);
  }
  function changeState(s: StateFilter) {
    setStateFilter(s);
    setLimit(PAGE);
  }

  return (
    <div>
      {closedCount > 0 && (
        <p className="mb-3 text-xs text-zinc-400">
          모집기간이 지난 {closedCount}건은 숨겼어요. (날짜 미정·상시 항목은 ‘전체’에 포함)
        </p>
      )}

      {/* 테마 탭 */}
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((t) => {
          const on = t === active;
          const count = byTab.get(t)?.length ?? 0;
          return (
            <button
              key={t}
              type="button"
              onClick={() => selectTab(t)}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                on
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400"
              }`}
            >
              {t} <span className={on ? "text-blue-100" : "text-zinc-400"}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* 지원기간 상태 필터 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-400 shrink-0">지원기간:</span>
        {STATE_FILTERS.map((f) => {
          const on = stateFilter === f.value;
          const c =
            f.value === "open"
              ? counts.open
              : f.value === "upcoming"
                ? counts.upcoming
                : f.value === "always"
                  ? counts.always
                  : counts.all;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => changeState(f.value)}
              className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                on
                  ? "border-green-600 bg-green-600 text-white"
                  : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-400"
              }`}
            >
              {f.label} <span className={on ? "text-green-100" : "text-zinc-400"}>{c}</span>
            </button>
          );
        })}
      </div>

      {/* 정렬 */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-400 shrink-0">정렬:</span>
        {SORT_OPTIONS.map((opt) => {
          const on = sortOrder === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => changeSort(opt.value)}
              className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                on
                  ? "border-zinc-700 bg-zinc-800 text-white"
                  : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-400"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* 카드 목록 */}
      {shown.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-6 text-center text-sm text-zinc-500">
          이 조건에 해당하는 항목이 없어요. ‘지원기간’ 필터를 ‘전체’로 바꿔 보세요.
        </div>
      ) : (
        <div className="space-y-4">
          {shown.map((r) => (
            <ResultCard key={r.benefit.id} result={r} applyInfo={statusOf.get(r.benefit.id)} />
          ))}
        </div>
      )}

      {limit < list.length && (
        <button
          type="button"
          onClick={() => setLimit((n) => n + PAGE)}
          className="mt-5 w-full rounded-xl border border-zinc-300 bg-white py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          더 보기 ({list.length - limit}건 남음)
        </button>
      )}
    </div>
  );
}
