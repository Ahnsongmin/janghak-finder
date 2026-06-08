import Link from "next/link";
import { getBenefits, isDemoData, sourceNames } from "@/lib/store";
import { matchAll } from "@/lib/match";
import type { UserProfile } from "@/lib/types";
import { ResultCard } from "@/app/components/result-card";

function buildProfile(sp: Record<string, string | string[] | undefined>): UserProfile {
  const get = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));
  const ageRaw = get("age");
  const age = ageRaw ? parseInt(ageRaw, 10) : undefined;
  return {
    region: get("region") ?? "",
    income: Number(get("income") ?? 0),
    age: Number.isFinite(age) ? age : undefined,
    eduStatus: get("edu") ?? "",
    grade: Number(get("grade") ?? 0),
    flags: (get("flags") ?? "").split(",").filter(Boolean),
  };
}

export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const user = buildProfile(sp);
  const { eligible, review, excludedCount } = matchAll(getBenefits(), user);
  const demo = isDemoData();

  // 화면 과부하 방지: 섹션별 표시 상한 (전체 건수는 별도 표기)
  const CAP = 40;
  const eligibleShown = eligible.slice(0, CAP);
  const reviewShown = review.slice(0, CAP);

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-zinc-900">매칭 결과</h1>
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ← 다시 입력
        </Link>
      </div>

      {demo && (
        <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <strong>예시(데모) 데이터로 표시 중입니다.</strong> 아직 정부 공식 API 키가 연결되지 않아
          실제 전체 데이터가 아닙니다. 각 항목의 정확한 조건은 반드시 공식 링크에서 확인하세요. (API 키
          연결 시 전체 장학금·지원금이 자동으로 채워집니다.)
        </div>
      )}

      <p className="mb-6 text-sm text-zinc-500">
        대상 가능 {eligible.length}건 · 조건 확인 필요 {review.length}건 · 제외 {excludedCount}건
        <span className="ml-2 text-zinc-400">(출처: {sourceNames().join(", ")})</span>
      </p>

      {eligible.length === 0 && review.length === 0 && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-6 text-center text-zinc-500">
          입력 조건에 맞는 항목을 찾지 못했어요. 입력을 줄이거나 바꿔서 다시 시도해 보세요.
        </div>
      )}

      {eligible.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-base font-semibold text-emerald-700">
            ✅ 받을 수 있을 것으로 보이는 항목 ({eligible.length}건)
          </h2>
          <div className="space-y-4">
            {eligibleShown.map((r) => (
              <ResultCard key={r.benefit.id} result={r} />
            ))}
          </div>
          {eligible.length > CAP && (
            <p className="mt-3 text-center text-sm text-zinc-400">
              상위 {CAP}건만 표시 중 · 외 {eligible.length - CAP}건 더 있음 (조건을 더 입력하면 좁혀집니다)
            </p>
          )}
        </section>
      )}

      {review.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold text-amber-700">
            ⚠️ 조건 확인이 필요한 항목 ({review.length}건)
          </h2>
          <div className="space-y-4">
            {reviewShown.map((r) => (
              <ResultCard key={r.benefit.id} result={r} />
            ))}
          </div>
          {review.length > CAP && (
            <p className="mt-3 text-center text-sm text-zinc-400">
              상위 {CAP}건만 표시 중 · 외 {review.length - CAP}건
            </p>
          )}
        </section>
      )}
    </main>
  );
}
