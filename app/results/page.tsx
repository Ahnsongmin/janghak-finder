import Link from "next/link";
import { getBenefits, isDemoData, sourceNames } from "@/lib/store";
import { matchAll } from "@/lib/match";
import type { UserProfile } from "@/lib/types";
import { ResultsView } from "@/app/components/results-view";
import universities from "@/data/universities.json";

type Univ = { name: string; homepage?: string; region?: string };
const UNIV_BY_NAME = new Map((universities as Univ[]).map((u) => [u.name, u]));

function buildProfile(sp: Record<string, string | string[] | undefined>): UserProfile {
  const get = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));
  const ageRaw = get("age");
  const age = ageRaw ? parseInt(ageRaw, 10) : undefined;
  const gpaRaw = get("gpa");
  const gpa = gpaRaw ? parseFloat(gpaRaw) : undefined;
  const gpaScaleRaw = get("gpaScale");
  const gpaScale = gpaScaleRaw ? parseFloat(gpaScaleRaw) : undefined;
  return {
    region: get("region") ?? "",
    income: Number(get("income") ?? 0),
    age: Number.isFinite(age) ? age : undefined,
    eduStatus: get("edu") ?? "",
    grade: Number(get("grade") ?? 0),
    gpa: Number.isFinite(gpa) ? gpa : undefined,
    gpaScale: Number.isFinite(gpaScale) ? gpaScale : undefined,
    univ: get("univ") ?? "",
    gender: get("gender") ?? "",
    faculty: get("faculty") ?? "",
    major: get("major") ?? "",
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
  const all = [...eligible, ...review];

  const univName = (Array.isArray(sp.univ) ? sp.univ[0] : sp.univ)?.trim();
  const univ = univName ? UNIV_BY_NAME.get(univName) : undefined;

  // AI 지원서 페이지로 넘길 프로필 파라미터(학과/지역/학년 자동연계)
  const draftParams = new URLSearchParams();
  if (user.major) draftParams.set("major", user.major);
  if (user.region) draftParams.set("region", user.region);
  if (user.grade) draftParams.set("grade", `${user.grade}학년`);
  const draftHref = `/draft${draftParams.toString() ? `?${draftParams}` : ""}`;

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-zinc-900">매칭 결과</h1>
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ← 다시 입력
        </Link>
      </div>

      <Link
        href={draftHref}
        className="mb-6 flex items-center justify-between rounded-xl border border-violet-200 bg-violet-50 p-4 transition-colors hover:bg-violet-100"
      >
        <span className="text-sm text-violet-800">
          ✍️ <strong>AI로 지원서 초안 쓰기</strong> — 키워드 몇 개면 담백한 초안을 만들어 드려요
        </span>
        <span className="text-violet-500">→</span>
      </Link>

      {demo && (
        <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <strong>예시(데모) 데이터로 표시 중입니다.</strong> 아직 정부 공식 API 키가 연결되지 않아
          실제 전체 데이터가 아닙니다. 각 항목의 정확한 조건은 반드시 공식 링크에서 확인하세요.
        </div>
      )}

      <p className="mb-6 text-sm text-zinc-500">
        대상 가능 {eligible.length}건 · 조건 확인 필요 {review.length}건 · 제외 {excludedCount}건
        <span className="ml-2 text-zinc-400">(출처: {sourceNames().join(", ")})</span>
      </p>

      {univName && (
        <div className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm">
          <p className="font-semibold text-indigo-800">🎓 {univName} 교내장학금</p>
          <p className="mt-1 text-indigo-700">
            대학별 교내장학금(성적우수·근로·재단 등)은 정부 공개 데이터에 없어, 학교 공식 페이지에서 직접
            확인해야 해요. 아래 링크로 바로 가세요.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {univ?.homepage && (
              <a
                href={univ.homepage}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                학교 홈페이지 →
              </a>
            )}
            <a
              href={`https://www.google.com/search?q=${encodeURIComponent(univName + " 장학금")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
            >
              ‘{univName} 장학금’ 검색 →
            </a>
          </div>
        </div>
      )}

      {all.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-6 text-center text-zinc-500">
          입력 조건에 맞는 항목을 찾지 못했어요. 입력을 줄이거나 바꿔서 다시 시도해 보세요.
        </div>
      ) : (
        <ResultsView results={all} />
      )}
    </main>
  );
}
