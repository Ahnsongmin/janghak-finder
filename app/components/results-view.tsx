"use client";

import { useMemo, useState } from "react";
import type { MatchResult } from "@/lib/types";
import { THEME_ORDER, themeOf, relevanceScore, type Theme } from "@/lib/theme";
import { ResultCard } from "./result-card";

const PAGE = 20;
const RECOMMEND = "추천";
const ALL = "전체";

export function ResultsView({ results }: { results: MatchResult[] }) {
  // 주제별 버킷 + 관련도순 정렬 (1회 계산)
  const { tabs, byTab } = useMemo(() => {
    const sorted = [...results].sort((a, b) => relevanceScore(b) - relevanceScore(a));
    const buckets = new Map<string, MatchResult[]>();
    for (const r of sorted) {
      const th = themeOf(r.benefit);
      (buckets.get(th) ?? buckets.set(th, []).get(th)!).push(r);
    }
    // 추천 = 장학금 + 청년·학생
    const recommend = sorted.filter((r) => {
      const th = themeOf(r.benefit);
      return th === "장학금" || th === "청년·학생";
    });

    const themeTabs = THEME_ORDER.filter((t) => (buckets.get(t)?.length ?? 0) > 0) as Theme[];
    const map = new Map<string, MatchResult[]>(buckets);
    if (recommend.length) map.set(RECOMMEND, recommend);
    map.set(ALL, sorted);

    const tabList = [
      ...(recommend.length ? [RECOMMEND] : []),
      ...themeTabs,
      ALL,
    ];
    return { tabs: tabList, byTab: map };
  }, [results]);

  const [active, setActive] = useState(tabs[0] ?? ALL);
  const [limit, setLimit] = useState(PAGE);

  const list = byTab.get(active) ?? [];
  const shown = list.slice(0, limit);

  function selectTab(t: string) {
    setActive(t);
    setLimit(PAGE);
  }

  return (
    <div>
      {/* 탭 바 */}
      <div className="mb-5 flex flex-wrap gap-2">
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

      {/* 카드 목록 */}
      <div className="space-y-4">
        {shown.map((r) => (
          <ResultCard key={r.benefit.id} result={r} />
        ))}
      </div>

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
