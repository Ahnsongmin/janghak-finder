import type { MatchResult } from "@/lib/types";

const CATEGORY_COLOR: Record<string, string> = {
  장학금: "bg-emerald-50 text-emerald-700 border-emerald-200",
  지원금: "bg-blue-50 text-blue-700 border-blue-200",
  대출: "bg-amber-50 text-amber-700 border-amber-200",
  기타: "bg-zinc-100 text-zinc-700 border-zinc-200",
};

export function ResultCard({ result }: { result: MatchResult }) {
  const { benefit: b, passed, unknown, status } = result;

  return (
    <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {status === "eligible" ? (
          <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
            대상 가능
          </span>
        ) : (
          <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
            조건 확인
          </span>
        )}
        <span
          className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
            CATEGORY_COLOR[b.category] ?? CATEGORY_COLOR["기타"]
          }`}
        >
          {b.category}
        </span>
        {b.demo && (
          <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-600">
            예시 데이터
          </span>
        )}
        <span className="text-xs text-zinc-400">출처: {b.sourceName}</span>
      </div>

      <h3 className="text-lg font-semibold text-zinc-900">{b.name}</h3>
      <p className="mt-0.5 text-sm text-zinc-500">{b.provider}</p>
      {b.description && <p className="mt-2 text-sm text-zinc-700">{b.description}</p>}

      <dl className="mt-3 grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2">
        {b.amount && <Info label="지원내용" value={b.amount} />}
        {b.applyPeriod && <Info label="신청기간" value={b.applyPeriod} />}
        {b.regions.length > 0 && <Info label="대상지역" value={b.regions.join(", ")} />}
        {b.incomeMax != null && <Info label="소득기준" value={`${b.incomeMax}구간 이하`} />}
        {(b.ageMin != null || b.ageMax != null) && (
          <Info label="연령" value={`${b.ageMin ?? "?"}~${b.ageMax ?? "?"}세`} />
        )}
      </dl>

      {passed.length > 0 && (
        <ul className="mt-3 space-y-1">
          {passed.map((p, i) => (
            <li key={i} className="flex gap-1.5 text-sm text-emerald-700">
              <span aria-hidden>✓</span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      )}

      {unknown.length > 0 && (
        <div className="mt-3 rounded-lg bg-amber-50 p-3">
          <p className="mb-1 text-xs font-semibold text-amber-700">확인이 필요한 조건</p>
          <ul className="space-y-1">
            {unknown.map((u, i) => (
              <li key={i} className="text-sm text-amber-700">
                • {u}
              </li>
            ))}
          </ul>
        </div>
      )}

      {b.rawConditionText && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-zinc-500 hover:text-zinc-700">
            원문 조건 보기
          </summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600">
            {b.rawConditionText}
          </pre>
        </details>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {b.applyUrl && (
          <a
            href={b.applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            공식 사이트에서 신청 →
          </a>
        )}
        {b.lastFetchedAt && (
          <span className="text-xs text-zinc-400">
            수집: {new Date(b.lastFetchedAt).toLocaleDateString("ko-KR")}
          </span>
        )}
      </div>
    </article>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0 text-zinc-400">{label}</dt>
      <dd className="text-zinc-700">{value}</dd>
    </div>
  );
}
