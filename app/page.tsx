"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SIDO, INCOME_OPTIONS, EDU_STATUS, GRADE_OPTIONS, SPECIAL_FLAGS } from "@/lib/options";
import { FACULTIES } from "@/lib/faculty";
import universities from "@/data/universities.json";

const UNIV_NAMES = (universities as { name: string }[]).map((u) => u.name);

export default function Home() {
  const router = useRouter();
  const [region, setRegion] = useState("");
  const [income, setIncome] = useState(0);
  const [age, setAge] = useState("");
  const [eduStatus, setEduStatus] = useState("");
  const [grade, setGrade] = useState(0);
  const [gender, setGender] = useState("");
  const [gpa, setGpa] = useState("");
  const [gpaScale, setGpaScale] = useState("4.5");
  const [univ, setUniv] = useState("");
  const [faculty, setFaculty] = useState("");
  const [major, setMajor] = useState("");
  const [flags, setFlags] = useState<string[]>([]);

  function toggleFlag(f: string) {
    setFlags((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  }

  function submit() {
    const p = new URLSearchParams();
    if (region) p.set("region", region);
    if (income) p.set("income", String(income));
    if (age) p.set("age", age);
    if (eduStatus) p.set("edu", eduStatus);
    if (grade) p.set("grade", String(grade));
    if (gender) p.set("gender", gender);
    if (gpa) {
      p.set("gpa", gpa);
      p.set("gpaScale", gpaScale);
    }
    if (univ) p.set("univ", univ);
    if (faculty) p.set("faculty", faculty);
    if (major) p.set("major", major);
    if (flags.length) p.set("flags", flags.join(","));
    router.push(`/results?${p.toString()}`);
  }

  const labelCls = "block text-sm font-medium text-zinc-700 mb-1.5";
  const fieldCls =
    "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-zinc-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
          내가 받을 수 있는 장학금·지원금 찾기
        </h1>
        <p className="mt-2 text-zinc-600">
          몇 가지만 입력하면 받을 수 있는 장학금·지원금과 신청 조건, 공식 신청 링크를 모아 보여드려요.
        </p>
      </header>

      <div className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div>
          <label className={labelCls}>거주지역 (시·도)</label>
          <select className={fieldCls} value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">선택 안 함</option>
            {SIDO.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>소득분위 (학자금 지원구간)</label>
          <select
            className={fieldCls}
            value={income}
            onChange={(e) => setIncome(Number(e.target.value))}
          >
            {INCOME_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>나이 (만)</label>
            <input
              type="number"
              inputMode="numeric"
              className={fieldCls}
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="예: 22"
            />
          </div>
          <div>
            <label className={labelCls}>학년</label>
            <select
              className={fieldCls}
              value={grade}
              onChange={(e) => setGrade(Number(e.target.value))}
            >
              {GRADE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className={labelCls}>재학 / 학력 상태</label>
          <select className={fieldCls} value={eduStatus} onChange={(e) => setEduStatus(e.target.value)}>
            <option value="">선택 안 함</option>
            {EDU_STATUS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>
            성별 <span className="font-normal text-zinc-400">(여성 전용 장학금 매칭용, 선택사항)</span>
          </label>
          <select className={fieldCls} value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="">선택 안 함</option>
            <option value="여성">여성</option>
            <option value="남성">남성</option>
          </select>
        </div>

        <div>
          <label className={labelCls}>
            평점평균 (학점) <span className="font-normal text-zinc-400">(선택사항)</span>
          </label>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              max="4.5"
              className={fieldCls}
              value={gpa}
              onChange={(e) => setGpa(e.target.value)}
              placeholder="예: 3.75"
            />
            <select
              className={fieldCls + " w-auto"}
              value={gpaScale}
              onChange={(e) => setGpaScale(e.target.value)}
              aria-label="만점 기준"
            >
              <option value="4.5">/ 4.5 만점</option>
              <option value="4.3">/ 4.3 만점</option>
              <option value="4.0">/ 4.0 만점</option>
            </select>
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            본인 학교 만점 기준을 그대로 선택하세요. 만점이 달라도 정확히 비교합니다(환산 불필요).
          </p>
        </div>

        <div>
          <label className={labelCls}>
            대학교 <span className="font-normal text-zinc-400">(검색해서 선택, 선택사항)</span>
          </label>
          <input
            type="text"
            list="univ-list"
            className={fieldCls}
            value={univ}
            onChange={(e) => setUniv(e.target.value)}
            placeholder="학교명 입력 (예: 서강대)"
          />
          <datalist id="univ-list">
            {UNIV_NAMES.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>

        <div>
          <label className={labelCls}>
            계열 <span className="font-normal text-zinc-400">(이공계 등 계열별 장학금 매칭용, 선택사항)</span>
          </label>
          <select className={fieldCls} value={faculty} onChange={(e) => setFaculty(e.target.value)}>
            <option value="">선택 안 함 (학과 입력 시 자동 분류)</option>
            {FACULTIES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>
            학과 / 전공 <span className="font-normal text-zinc-400">(입력하면 학과별 장학금까지, 선택사항)</span>
          </label>
          <input
            type="text"
            className={fieldCls}
            value={major}
            onChange={(e) => setMajor(e.target.value)}
            placeholder="예: 기계공학과, 서어서문학과, 경제학과"
          />
          <p className="mt-1 text-xs text-zinc-400">
            계열을 비워두면 학과명으로 자동 분류해요. (예: “기계공학과” → 공학계열)
          </p>
        </div>

        <div>
          <label className={labelCls}>해당하는 특수자격 (중복 선택)</label>
          <div className="flex flex-wrap gap-2">
            {SPECIAL_FLAGS.map((f) => {
              const on = flags.includes(f);
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => toggleFlag(f)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    on
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400"
                  }`}
                >
                  {f}
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={submit}
          className="mt-2 w-full rounded-xl bg-blue-600 py-3.5 text-base font-semibold text-white transition-colors hover:bg-blue-700"
        >
          받을 수 있는 항목 찾기
        </button>
      </div>

      <p className="mt-4 text-center text-xs text-zinc-400">
        입력 정보는 매칭에만 쓰이며 저장되지 않습니다. 모든 결과에는 공식 출처와 신청 링크가 함께 표시됩니다.
      </p>
    </main>
  );
}
