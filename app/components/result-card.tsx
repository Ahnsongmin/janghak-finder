import Link from "next/link";
import type { Benefit, MatchResult } from "@/lib/types";
import { type ApplyInfo, fmtMD, fmtPeriod, daysLeft } from "@/lib/apply-status";

/** 지원시기를 한눈에 — 상태색 + 읽기 쉬운 날짜 + 마감 D-day */
function TimingBlock({ b, info }: { b: Benefit; info?: ApplyInfo }) {
  const period = fmtPeriod(b.applyPeriod);

  let tone = "border-zinc-200 bg-zinc-50";
  let dot = "bg-zinc-300";
  let labelTone = "text-ink/45";
  let head = "지원시기";
  let main = period || "상시·수시 모집";
  let sub: string | null = null;
  let dday: { text: string; urgent: boolean } | null = null;

  if (info?.state === "open") {
    const d = daysLeft(info.end);
    const urgent = d != null && d >= 0 && d <= 7;
    tone = urgent ? "border-rose-200 bg-rose-50" : "border-mint/30 bg-mint-soft";
    dot = urgent ? "bg-rose-500" : "bg-mint";
    labelTone = urgent ? "text-rose-700" : "text-mint-strong";
    head = urgent ? "마감 임박" : "지금 지원 가능";
    main = period || (info.end ? `~ ${fmtMD(info.end)} 마감` : "상시 모집");
    // D-day는 90일 이내일 때만 (먼 미래 종료일의 비현실적 D-1000+ 표시 방지)
    if (d != null && d >= 0 && d <= 90)
      dday = { text: d === 0 ? "오늘 마감" : `D-${d}`, urgent };
  } else if (info?.state === "upcoming") {
    const d = daysLeft(info.start);
    tone = "border-sky-200 bg-sky-50";
    dot = "bg-sky-500";
    labelTone = "text-sky-700";
    head = "곧 열림";
    main = period || (info.start ? `${fmtMD(info.start)}부터 시작` : "");
    if (d != null && d >= 0 && d <= 90) dday = { text: `D-${d}`, urgent: false };
  } else {
    head = "지원시기";
    main = period || "상시·수시 모집";
    if (!b.applyPeriod) sub = "공식 사이트에서 모집기간을 확인하세요";
  }

  return (
    <div className={`mt-3 flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 ${tone}`}>
      <span aria-hidden className="text-base leading-none">📅</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
          <span className={`text-[11px] font-bold uppercase tracking-wide ${labelTone}`}>
            {head}
          </span>
        </div>
        <p className="mt-0.5 text-sm font-bold leading-snug text-ink">{main}</p>
        {sub && <p className="text-xs text-ink/50">{sub}</p>}
      </div>
      {dday && (
        <span
          className={`shrink-0 rounded-md px-2 py-1 text-xs font-extrabold ${
            dday.urgent ? "bg-rose-600 text-white" : "bg-white/80 text-ink/70"
          }`}
        >
          {dday.text}
        </span>
      )}
    </div>
  );
}

const CATEGORY_COLOR: Record<string, string> = {
  장학금: "bg-mint-soft text-mint-strong border-mint/20",
  지원금: "bg-brand-soft text-brand border-brand/20",
  대출: "bg-amber-50 text-amber-700 border-amber-200",
  기타: "bg-zinc-100 text-ink/65 border-zinc-200",
};

export function ResultCard({ result, applyInfo }: { result: MatchResult; applyInfo?: ApplyInfo }) {
  const { benefit: b, passed, unknown, status } = result;

  return (
    <article className="group rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-card transition-all hover:border-brand/30 hover:shadow-card-lg">
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        {status === "eligible" ? (
          <span className="rounded-md border border-mint/30 bg-mint-soft px-2 py-0.5 text-xs font-bold text-mint-strong">
            대상 가능
          </span>
        ) : (
          <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700">
            조건 확인
          </span>
        )}
        <span
          className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${
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
        <span className="ml-auto text-xs text-ink/40">출처: {b.sourceName}</span>
      </div>

      <h3 className="text-lg font-bold leading-snug text-ink">
        <Link
          href={`/s/${encodeURIComponent(b.id)}`}
          className="transition-colors hover:text-brand"
        >
          {b.name}
        </Link>
      </h3>
      <p className="mt-0.5 text-sm text-ink/50">{b.provider}</p>

      {/* 지원금액 — 카드의 핵심, 가장 강조 */}
      {b.amount && (
        <div className="mt-3 rounded-xl border border-brand/15 bg-brand-soft/60 px-3.5 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand/70">지원내용</p>
          <p className="mt-0.5 text-[15px] font-bold leading-snug text-brand-strong">{b.amount}</p>
        </div>
      )}

      {/* 지원시기 — 한눈에 보이게 강조 */}
      <TimingBlock b={b} info={applyInfo} />

      {b.description && <p className="mt-3 text-sm leading-relaxed text-ink/70">{b.description}</p>}

      <dl className="mt-3 grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2">
        {b.regions.length > 0 && <Info label="대상지역" value={b.regions.join(", ")} />}
        {b.incomeMax != null && <Info label="소득기준" value={`${b.incomeMax}구간 이하`} />}
        {(b.ageMin != null || b.ageMax != null) && (
          <Info label="연령" value={`${b.ageMin ?? "?"}~${b.ageMax ?? "?"}세`} />
        )}
      </dl>

      {passed.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {passed.map((p, i) => (
            <li
              key={i}
              className="inline-flex items-center gap-1 rounded-lg bg-mint-soft px-2 py-1 text-xs font-medium text-mint-strong"
            >
              <span aria-hidden>✓</span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      )}

      {unknown.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 p-3">
          <p className="mb-1 text-xs font-bold text-amber-700">확인이 필요한 조건</p>
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
          <summary className="cursor-pointer font-medium text-ink/50 transition-colors hover:text-ink/80">
            원문 조건 보기
          </summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-xs text-ink/60">
            {b.rawConditionText}
          </pre>
        </details>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        {b.applyUrl && (
          <a
            href={b.applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl bg-gradient-to-r from-brand to-brand-strong px-4 py-2.5 text-sm font-bold text-white shadow-brand transition-all hover:brightness-105 active:scale-[.99]"
          >
            공식 사이트에서 신청 →
          </a>
        )}
        {(b.category === "장학금" || b.category === "지원금") && (
          <Link
            href={`/draft?scholarship=${encodeURIComponent(b.name)}`}
            className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-bold text-violet-700 transition-colors hover:bg-violet-100"
          >
            ✍️ AI 지원서 초안
          </Link>
        )}
        {b.lastFetchedAt && (
          <span className="ml-auto text-xs text-ink/35">
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
      <dt className="shrink-0 text-ink/40">{label}</dt>
      <dd className="text-ink/75">{value}</dd>
    </div>
  );
}
