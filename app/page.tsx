"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SIDO, INCOME_OPTIONS, EDU_STATUS, GRADE_OPTIONS, SPECIAL_FLAGS } from "@/lib/options";
import { FACULTIES } from "@/lib/faculty";
import universities from "@/data/universities.json";

const UNIV_NAMES = (universities as { name: string }[]).map((u) => u.name);

// 첫 화면에서 "이런 걸 찾아드려요"로 보여줄 대표 장학금 (실데이터, /s 상세로 연결)
const SHOWCASE = [
  { id: "nat:kosaf:type1", name: "국가장학금 Ⅰ유형", amount: "최대 등록금 전액", tag: "전국·전 대학" },
  { id: "fnd:cmk:ondream", name: "현대차 정몽구 온드림", amount: "등록금 전액 + 학기당 180만", tag: "민간재단" },
  { id: "fnd:kochon:living", name: "종근당고촌 생활비 장학금", amount: "월 50만원 · 최대 3년", tag: "생활비" },
];

// 시즌 공지 — 마감일이 지나면 자동으로 사라진다(다시는 stale 안 됨).
// 한국장학재단 2026 2학기 일정. 새 마감이 확정되면 여기에 추가만 하면 됨.
function currentNotice(now = new Date()): { label: string; emphasis: string } | null {
  const deadline = (y: number, m: number, d: number, h: number) =>
    new Date(y, m - 1, d, h, 0, 0);
  // 2차 신청: 8/12(수) 09:00 ~ 9/9(수) 18:00 (대학 공식 장학공지 다수 확인, 2026-08-22)
  if (now <= deadline(2026, 9, 9, 18))
    return {
      label: "2학기 국가장학금 2차 신청",
      emphasis: "9월 9일(수) 18시 마감",
    };
  // 2차 서류제출·가구원 정보제공 동의: ~9/16(수) 18:00
  if (now <= deadline(2026, 9, 16, 18))
    return {
      label: "2학기 국가장학금 2차 서류제출·가구원동의",
      emphasis: "9월 16일(수) 18시까지",
    };
  return null;
}

export default function Home() {
  const router = useRouter();
  const [region, setRegion] = useState("");
  const [income, setIncome] = useState(0);
  const [age, setAge] = useState("");
  const [eduStatus, setEduStatus] = useState("");
  const [grade, setGrade] = useState(0);
  const [gender, setGender] = useState("");
  const [gpa, setGpa] = useState("");
  const [lastGpa, setLastGpa] = useState("");
  const [gpaScale, setGpaScale] = useState("4.5");
  const [univ, setUniv] = useState("");
  const [faculty, setFaculty] = useState("");
  const [major, setMajor] = useState("");
  const [flags, setFlags] = useState<string[]>([]);
  const [showMore, setShowMore] = useState(false);

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
    if (gpa) p.set("gpa", gpa);
    if (lastGpa) p.set("lastGpa", lastGpa);
    if (gpa || lastGpa) p.set("gpaScale", gpaScale);
    if (univ) p.set("univ", univ);
    if (faculty) p.set("faculty", faculty);
    if (major) p.set("major", major);
    if (flags.length) p.set("flags", flags.join(","));
    router.push(`/results?${p.toString()}`);
  }

  const labelCls = "block text-sm font-semibold text-ink mb-1.5";
  const fieldCls =
    "w-full appearance-none rounded-xl border border-zinc-200 bg-zinc-50/60 px-3.5 py-3 text-ink outline-none transition-all focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand/10";

  const notice = currentNotice();

  return (
    <main className="hero-mesh">
      <div className="mx-auto w-full max-w-2xl px-5 pb-20 pt-9">
        {/* 시즌 배너 — 마감 지나면 자동으로 사라짐(currentNotice가 null 반환) */}
        {notice && (
          <div className="mb-8 flex items-center justify-center gap-2 rounded-full border border-amber-200 bg-amber-50/80 px-4 py-2 text-sm font-medium text-amber-800 shadow-sm backdrop-blur">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
            </span>
            {notice.label}, <b>{notice.emphasis}</b>
          </div>
        )}

        <header className="mb-9 text-center animate-fade-up">
          <div className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-brand/15 bg-brand-soft px-3.5 py-1.5 text-xs font-semibold text-brand">
            <span className="grid h-4 w-4 place-items-center rounded-full bg-brand text-[9px] text-white">
              ✓
            </span>
            정부 공식 데이터 9,800여 건 실시간 매칭
          </div>
          <h1 className="text-[32px] font-extrabold leading-[1.22] tracking-tight text-ink sm:text-[42px]">
            나라가 주는 돈,
            <br />
            안 받으면 <span className="bg-gradient-to-r from-brand to-mint bg-clip-text text-transparent">그냥 사라져요</span>
          </h1>
          <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-ink/55">
            장학금·지원금 <b className="text-ink/80">9,800여 건</b> 중에 내가 받을 수 있는 것만 골라드려요.
            <br className="hidden sm:block" />
            입력 30초, 로그인 없음.
          </p>

          {/* 신뢰 시그널 */}
          <div className="mx-auto mt-6 flex max-w-md flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-medium text-ink/50">
            <span className="flex items-center gap-1.5">
              <span className="text-mint">●</span> 회원가입 없음
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-mint">●</span> 정보 저장 안 함
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-mint">●</span> 공식 신청 링크 제공
            </span>
          </div>
        </header>

        {/* 입력 — 핵심 3개만 먼저, 나머지는 접어서 가볍게 */}
        <div className="rounded-3xl border border-zinc-200/80 bg-white/95 p-6 shadow-card-lg backdrop-blur sm:p-8 animate-fade-up">
          <div className="mb-5 flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-soft text-sm font-bold text-brand">
              1
            </span>
            <h2 className="text-base font-bold text-ink">기본 조건만 입력하면 끝</h2>
          </div>

          <div className="space-y-5">
            <div>
              <label className={labelCls} htmlFor="region">거주지역 (시·도)</label>
              <select id="region" className={fieldCls} value={region} onChange={(e) => setRegion(e.target.value)}>
                <option value="">선택 안 함</option>
                {SIDO.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls} htmlFor="income">소득분위 (학자금 지원구간)</label>
              <select
                id="income"
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
              <p className="mt-1.5 text-xs text-ink/40">몰라도 괜찮아요 — 그대로 두면 전부 보여드려요.</p>
            </div>

            <div>
              <label className={labelCls} htmlFor="edu">재학 / 학력 상태</label>
              <select id="edu" className={fieldCls} value={eduStatus} onChange={(e) => setEduStatus(e.target.value)}>
                <option value="">선택 안 함</option>
                {EDU_STATUS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {/* 선택 조건 — 펼치면 더 정밀해짐 */}
            {!showMore ? (
              <button
                type="button"
                onClick={() => setShowMore(true)}
                className="group flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 py-3.5 text-sm font-semibold text-ink/55 transition-all hover:border-brand hover:bg-brand-soft hover:text-brand"
              >
                <span className="grid h-5 w-5 place-items-center rounded-md bg-zinc-100 text-xs transition-colors group-hover:bg-brand group-hover:text-white">
                  +
                </span>
                대학·학과·학점까지 입력하고 더 정확하게 받기
                <span className="text-xs font-normal text-ink/35">(선택)</span>
              </button>
            ) : (
              <div className="space-y-5 rounded-2xl border border-zinc-100 bg-zinc-50/70 p-4 sm:p-5 animate-fade-up">
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-md bg-mint-soft text-xs font-bold text-mint-strong">
                    2
                  </span>
                  <p className="text-xs font-bold uppercase tracking-wide text-ink/50">
                    채울수록 교내·학과 전용 장학금까지 잡혀요
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls} htmlFor="age">나이 (만)</label>
                    <input
                      id="age"
                      type="number"
                      inputMode="numeric"
                      className={fieldCls}
                      value={age}
                      onChange={(e) => setAge(e.target.value)}
                      placeholder="예: 22"
                    />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="grade">학년</label>
                    <select
                      id="grade"
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
                  <label className={labelCls} htmlFor="univ">대학교</label>
                  <input
                    id="univ"
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

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls} htmlFor="faculty">계열</label>
                    <select id="faculty" className={fieldCls} value={faculty} onChange={(e) => setFaculty(e.target.value)}>
                      <option value="">자동 분류</option>
                      {FACULTIES.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="major">학과 / 전공</label>
                    <input
                      id="major"
                      type="text"
                      className={fieldCls}
                      value={major}
                      onChange={(e) => setMajor(e.target.value)}
                      placeholder="예: 기계공학과"
                    />
                  </div>
                </div>

                <div>
                  <label className={labelCls} htmlFor="gpa">평점평균 (학점)</label>
                  <div className="grid grid-cols-[1fr_auto] gap-3">
                    <input
                      id="gpa"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      max="4.5"
                      className={fieldCls}
                      value={gpa}
                      onChange={(e) => setGpa(e.target.value)}
                      placeholder="전체 평점 예: 3.75"
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
                  <p className="mt-1.5 text-xs text-ink/40">
                    본인 학교 만점 기준 그대로 — 만점이 달라도 정확히 비교해요.
                  </p>
                </div>

                <div>
                  <label className={labelCls} htmlFor="lastGpa">
                    직전학기 평점 <span className="font-normal text-ink/40">(선택)</span>
                  </label>
                  <input
                    id="lastGpa"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    max="4.5"
                    className={fieldCls}
                    value={lastGpa}
                    onChange={(e) => setLastGpa(e.target.value)}
                    placeholder="예: 3.9"
                  />
                  <p className="mt-1.5 text-xs text-ink/40">
                    &lsquo;직전학기 성적 O.O 이상&rsquo;을 보는 장학금이 많아요. 만점 기준은 위와 동일하게 적용돼요.
                  </p>
                </div>

                <div>
                  <label className={labelCls} htmlFor="gender">성별 <span className="font-normal text-ink/40">(여성 전용 장학금 매칭용)</span></label>
                  <select id="gender" className={fieldCls} value={gender} onChange={(e) => setGender(e.target.value)}>
                    <option value="">선택 안 함</option>
                    <option value="여성">여성</option>
                    <option value="남성">남성</option>
                  </select>
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
                          aria-pressed={on}
                          onClick={() => toggleFlag(f)}
                          className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all ${
                            on
                              ? "border-brand bg-brand text-white shadow-brand"
                              : "border-zinc-200 bg-white text-ink/65 hover:border-brand/40 hover:text-brand"
                          }`}
                        >
                          {f}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={submit}
              className="group w-full rounded-2xl bg-gradient-to-r from-brand to-brand-strong py-4 text-base font-bold text-white shadow-brand transition-all hover:brightness-105 active:scale-[.99]"
            >
              받을 수 있는 장학금 찾기
              <span className="ml-1.5 inline-block transition-transform group-hover:translate-x-1">→</span>
            </button>
            <p className="text-center text-xs text-ink/40">
              입력 정보는 매칭에만 쓰이고 저장되지 않아요. 로그인도 없어요.
            </p>
          </div>
        </div>

        {/* 이런 걸 찾아드려요 — 실데이터 맛보기 */}
        <section className="mt-14">
          <h2 className="mb-1.5 text-center text-xl font-bold text-ink">예를 들면 이런 것들이요</h2>
          <p className="mb-6 text-center text-sm text-ink/50">전부 실제 데이터 — 출처와 공식 신청 링크가 붙어 있어요.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {SHOWCASE.map((s) => (
              <Link
                key={s.id}
                href={`/s/${encodeURIComponent(s.id)}`}
                className="group flex flex-col rounded-2xl border border-zinc-200/80 bg-white/95 p-4 shadow-card transition-all hover:-translate-y-1 hover:border-brand/40 hover:shadow-card-lg"
              >
                <p className="text-xs font-semibold text-ink/40">{s.tag}</p>
                <p className="mt-1.5 font-bold leading-snug text-ink transition-colors group-hover:text-brand">{s.name}</p>
                <p className="mt-auto pt-3 text-sm font-bold text-brand">{s.amount}</p>
              </Link>
            ))}
          </div>
        </section>

        {/* 3단계 안내 */}
        <section className="mt-14 grid gap-3 text-center sm:grid-cols-3">
          {[
            ["1", "조건 입력", "30초면 충분해요"],
            ["2", "자동 매칭", "9,800여 건에서 골라드려요"],
            ["3", "바로 신청", "공식 링크 + AI 지원서 초안"],
          ].map(([n, t, d]) => (
            <div key={n} className="rounded-2xl border border-zinc-200/80 bg-white/95 p-6 shadow-card">
              <span className="mx-auto grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-brand to-brand-strong text-sm font-extrabold text-white shadow-brand">
                {n}
              </span>
              <p className="mt-3 font-bold text-ink">{t}</p>
              <p className="mt-0.5 text-sm text-ink/50">{d}</p>
            </div>
          ))}
        </section>

        {/* AI 지원서 크로스셀 */}
        <section className="mt-14 overflow-hidden rounded-3xl border border-violet-200/70 bg-gradient-to-br from-violet-50 via-white to-brand-soft p-7 text-center shadow-card sm:p-9">
          <p className="text-xl font-bold text-ink">✍️ 지원동기 쓰는 게 제일 귀찮죠?</p>
          <p className="mx-auto mt-2.5 max-w-md text-sm leading-relaxed text-ink/60">
            키워드 몇 개만 주면 <b className="text-ink/85">지원서에 특화된 전문 AI</b>가 담백한 초안을 쓰고, 첨삭
            AI가 한 번 더 다듬어요. 그래서 AI 티가 안 나요. <b className="text-violet-700">첫 1회 무료.</b>
          </p>
          <Link
            href="/draft"
            className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-6 py-3 text-sm font-bold text-white shadow-[0_10px_24px_-10px_rgba(124,58,237,.6)] transition-all hover:bg-violet-700 active:scale-[.99]"
          >
            AI 지원서 초안 써보기 →
          </Link>
        </section>
      </div>
    </main>
  );
}
