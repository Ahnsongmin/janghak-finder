// /results 스트리밍 대기 중 스켈레톤 — 매칭 계산 동안 빈 화면 대신 보여줌
export default function ResultsLoading() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-9">
      <div className="mb-5 flex items-center justify-between">
        <div className="skeleton h-8 w-32 rounded-lg" />
        <div className="skeleton h-8 w-24 rounded-full" />
      </div>

      {/* 요약 통계 스켈레톤 */}
      <div className="mb-5 grid grid-cols-3 gap-2.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-[72px] rounded-2xl" />
        ))}
      </div>

      {/* 필터 패널 스켈레톤 */}
      <div className="mb-5 rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-card">
        <div className="flex flex-wrap gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-8 w-20 rounded-full" />
          ))}
        </div>
      </div>

      {/* 카드 스켈레톤 */}
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-card">
            <div className="mb-3 flex gap-2">
              <div className="skeleton h-5 w-24 rounded-md" />
              <div className="skeleton h-5 w-16 rounded-md" />
            </div>
            <div className="skeleton mb-2 h-6 w-3/4 rounded" />
            <div className="skeleton mb-3 h-4 w-1/3 rounded" />
            <div className="skeleton h-14 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </main>
  );
}
