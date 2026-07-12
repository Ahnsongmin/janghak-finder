// 장학금/지원금 상세 페이지 — 검색 유입용 SEO 페이지.
// 9,000+건 전부 빌드하지 않고 요청 시 렌더 + 일일 캐시(ISR).

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBenefitById, getBenefits } from "@/lib/store";

export const revalidate = 86400;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const b = getBenefitById(decodeURIComponent(id));
  if (!b) return { title: "찾을 수 없는 항목" };
  const desc = (b.description ?? b.rawConditionText ?? `${b.provider}의 ${b.category}`)
    .replace(/\s+/g, " ")
    .slice(0, 150);
  return {
    title: `${b.name} — 자격조건·신청기간·신청방법`,
    description: desc,
  };
}

export default async function BenefitPage({ params }: Props) {
  const { id } = await params;
  const b = getBenefitById(decodeURIComponent(id));
  if (!b) notFound();

  // 같은 출처/지역의 다른 장학금 — 내부 링크(SEO 크롤링·체류시간)
  const related = getBenefits()
    .filter((o) => o.id !== b.id && o.category === b.category && (o.provider === b.provider || o.regions[0] === b.regions[0]))
    .slice(0, 6);

  const rows: [string, string | undefined | null][] = [
    ["지원내용", b.amount],
    ["신청기간", b.applyPeriod],
    ["신청방법", b.applyMethod],
    ["제출서류", b.submitDocs],
    ["대상지역", b.regions.join(", ")],
    ["소득기준", b.incomeMax != null ? `${b.incomeMax}구간 이하` : b.incomeNote],
    ["연령", b.ageMin != null || b.ageMax != null ? `${b.ageMin ?? "?"}~${b.ageMax ?? "?"}세` : null],
    ["성적기준", b.gpaMin != null ? `${b.gpaMin} 이상 (${b.gpaScale ?? 4.5} 만점)` : null],
    ["대상대학", b.university],
    ["대상계열", b.faculties?.join(", ")],
  ];

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-9">
      <div className="mb-5 text-sm">
        <Link
          href="/"
          className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 font-semibold text-ink/60 transition-colors hover:border-brand/40 hover:text-brand"
        >
          ← 장학금·지원금 찾기
        </Link>
      </div>

      <p className="mb-1.5 text-xs font-semibold text-ink/40">{b.sourceName} · {b.category}</p>
      <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-ink">{b.name}</h1>
      <p className="mt-1.5 text-ink/55">{b.provider}</p>
      {b.description && <p className="mt-4 text-[15px] leading-relaxed text-ink/75">{b.description}</p>}

      <dl className="mt-6 divide-y divide-zinc-100 rounded-2xl border border-zinc-200/80 bg-white px-5 shadow-card">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="grid grid-cols-[88px_1fr] gap-3 py-3 text-sm">
              <dt className="text-zinc-400">{k}</dt>
              <dd className="whitespace-pre-wrap text-zinc-800">{v}</dd>
            </div>
          ))}
      </dl>

      {b.rawConditionText && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-zinc-500 hover:text-zinc-700">원문 조건 보기</summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600">{b.rawConditionText}</pre>
        </details>
      )}

      <div className="mt-6 flex flex-wrap gap-2.5">
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
            ✍️ AI 지원서 초안 쓰기
          </Link>
        )}
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-brand/15 bg-gradient-to-br from-brand-soft to-white p-6 text-center shadow-card">
        <p className="mb-2 text-base font-bold text-ink">이 장학금, 내가 받을 수 있을까?</p>
        <p className="mb-4 text-sm text-ink/55">거주지·소득구간·대학·학과를 입력하면 받을 수 있는 장학금·지원금을 한 번에 찾아드려요.</p>
        <Link href="/" className="inline-block rounded-xl bg-gradient-to-r from-brand to-brand-strong px-6 py-2.5 text-sm font-bold text-white shadow-brand transition-all hover:brightness-105">
          내 조건으로 전체 매칭해보기
        </Link>
      </div>

      {related.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-zinc-700">함께 볼 만한 {b.category}</h2>
          <ul className="space-y-2">
            {related.map((o) => (
              <li key={o.id}>
                <Link href={`/s/${encodeURIComponent(o.id)}`} className="text-sm text-blue-600 hover:underline">
                  {o.name} <span className="text-zinc-400">— {o.provider}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-8 text-xs text-zinc-400">
        출처: {b.sourceName}
        {b.lastFetchedAt && ` · 수집 ${new Date(b.lastFetchedAt).toLocaleDateString("ko-KR")}`} · 정확한 조건은 반드시
        공식 페이지에서 확인하세요.
      </p>
    </main>
  );
}
