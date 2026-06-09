import type { Benefit, UserProfile, MatchResult, MatchStatus } from "./types";
import { resolveFaculty } from "./faculty";

// 매칭 엔진.
// 각 조건을 3-state로 판정한다: 통과(pass) / 불충족(fail) / 정보부족(unknown).
// - 하나라도 fail → excluded (대상 아님, 결과에서 숨김)
// - fail 없고 unknown 있음 → review (조건 확인 필요로 별도 표시)  ← 누락 방지 핵심
// - 모두 pass → eligible
// "정보 부족이면 일단 보여준다"가 원칙. 사용자가 놓치는 것을 막기 위함.

type Verdict = "pass" | "fail" | "unknown";

function checkRegion(b: Benefit, u: UserProfile): { v: Verdict; msg: string } {
  if (b.regions.length === 0) return { v: "unknown", msg: "거주지역 조건 미상 — 확인 필요" };
  if (b.regions.includes("전국")) return { v: "pass", msg: "전국 대상" };
  if (!u.region) return { v: "unknown", msg: `지역 조건 있음(${b.regions.join(", ")}) — 주소 입력 시 확인` };
  return b.regions.includes(u.region)
    ? { v: "pass", msg: `거주지역 일치(${u.region})` }
    : { v: "fail", msg: `거주지역 불일치 (대상: ${b.regions.join(", ")})` };
}

// 가계곤란/저소득·복지 연계(소득 심사형) 신호 — 명시 구간이 없어도 상위 소득은 사실상 제외.
// 복지급여(생계·의료·주거·교육)/수급가구/차상위/한부모/긴급복지/소득인정액 등 폭넓게 포착.
const MEANS_TESTED =
  /가계\s*곤란|저소득|소득\s*심사|가(?:정|계)\s*형편|형편이?\s*어려|생활\s*곤란|생활이?\s*곤란|생활환경[^\n]{0,4}어려|경제적[^\n]{0,4}어려|학비\s*조달|학자금\s*조달|기초\s*생활|국민기초|기초수급|수급\s*(?:가구|자|권자|세대)|복지\s*급여|생계\s*급여|의료\s*급여|주거\s*급여|교육\s*급여|차상위|한부모|긴급\s*복지|소득\s*인정액|법정\s*저소득|기초연금|(?:소득|가계소득|소득구간|지원구간|소득분위)[^\n]{0,4}낮/;

// 이름 자체가 수급자·저소득 전용 복지급여 프로그램인 신호 — 소득 필드가 비어 있어도 상위 소득은 제외.
// (이름 기반이라 '수급자 우대' 정도만 언급하는 일반 지원사업/장학금을 오탐하지 않는다)
const WELFARE_NAME = /생계급여|의료급여|주거급여|교육급여|기초연금|국민기초생활|기초생활(?:보장)?/;

// 중위소득 비율(%) → 한국장학재단 학자금 지원구간(분위) 상한 환산(2024 구간표 근사).
// 1구간≈30%, 2≈50%, 3≈70%, 4≈90%, 5≈100%, 6≈130%, 7≈150%, 8≈200%, 9≈300%, 10=초과.
function medianPctToBracket(pct: number): number {
  if (pct <= 30) return 1;
  if (pct <= 50) return 2;
  if (pct <= 70) return 3;
  if (pct <= 90) return 4;
  if (pct <= 100) return 5;
  if (pct <= 130) return 6;
  if (pct <= 150) return 7;
  if (pct <= 200) return 8;
  if (pct <= 300) return 9;
  return 10;
}

// incomeNote 원문에서 소득 상한(분위/구간)을 추론한다. 못 찾으면 null.
// 분위·구간 명시가 우선(정확). 없으면 '중위소득 N%'를 환산한다.
// 복수 % 조건(예: 독립가구 60% + 원가구 100%)은 '가장 느슨한' 쪽으로 환산 → 과도한 제외(누락) 방지.
function inferIncomeCeiling(note: string): number | null {
  const brackets = [...note.matchAll(/(\d{1,2})\s*(?:분위|구간)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= 1 && n <= 10);
  if (brackets.length) return Math.max(...brackets);

  // '중위소득'이 언급되면 본문의 백분율 중 가장 큰 값을 구간으로 환산.
  // 범위('100~150%')·괄호 삽입('중위소득(4인 가구) 대비 200%')에도 견고. 복수 조건은 느슨한 쪽=누락 방지.
  if (/중위소득/.test(note)) {
    const pcts = [...note.matchAll(/(\d{2,3})\s*%/g)]
      .map((m) => Number(m[1]))
      .filter((n) => n >= 10 && n <= 500);
    if (pcts.length) return medianPctToBracket(Math.max(...pcts));
    // '기준중위소득 이내/이하'처럼 %가 생략되면 통상 100%(중위소득 자체)를 뜻한다 → 5구간.
    if (/중위소득[^\n]{0,8}(?:이내|이하|미만)/.test(note)) return 5;
  }

  return null;
}

function checkIncome(b: Benefit, u: UserProfile): { v: Verdict; msg: string } {
  if (b.incomeMax == null) {
    const note = b.incomeNote?.trim();
    if (!note) {
      // 소득 조건 필드는 없지만 이름이 복지급여(생계·의료·주거·교육급여 등)면 수급자 전용 → 상위 소득 제외.
      if (WELFARE_NAME.test(b.name) && u.income >= 7) {
        return { v: "fail", msg: `수급자·저소득 전용 복지급여 — 소득 상위구간(${u.income}분위)은 대상 아님` };
      }
      return { v: "pass", msg: "소득 조건 무관" };
    }

    // 1) 원문에서 소득 상한(분위/구간/중위소득%)을 추론할 수 있으면 정확히 비교한다.
    const ceiling = inferIncomeCeiling(note);
    if (ceiling != null) {
      if (u.income === 0) {
        return { v: "unknown", msg: `소득 약 ${ceiling}구간 이하 대상 — 소득분위 입력 시 확인` };
      }
      return u.income <= ceiling
        ? { v: "unknown", msg: `소득 조건: ${note} — 확인 필요` }
        : { v: "fail", msg: `소득 기준 초과 (대상 약 ${ceiling}구간 이하 · 내 소득 ${u.income}분위)` };
    }

    // 2) 숫자 상한은 없지만 저소득·복지 연계 신호가 있으면, 상위 소득(7분위 이상)은 제외한다.
    //    (수급가구·생계급여 등은 7~10분위 고소득자가 대상일 수 없음)
    if (MEANS_TESTED.test(note) && u.income >= 7) {
      return { v: "fail", msg: `저소득·복지 연계 대상 — 소득 상위구간(${u.income}분위)은 대상 아님` };
    }
    return { v: "unknown", msg: `소득 조건: ${note} — 확인 필요` };
  }
  if (u.income === 0) return { v: "unknown", msg: `소득 ${b.incomeMax}구간 이하 대상 — 소득분위 입력 시 확인` };
  return u.income <= b.incomeMax
    ? { v: "pass", msg: `소득 ${u.income}구간 ≤ 기준 ${b.incomeMax}구간` }
    : { v: "fail", msg: `소득 기준 초과 (대상: ${b.incomeMax}구간 이하)` };
}

function checkAge(b: Benefit, u: UserProfile): { v: Verdict; msg: string } {
  if (b.ageMin == null && b.ageMax == null) return { v: "pass", msg: "연령 무관" };
  const range = `${b.ageMin ?? "?"}~${b.ageMax ?? "?"}세`;
  if (u.age == null) return { v: "unknown", msg: `연령 조건(${range}) — 나이 입력 시 확인` };
  if (b.ageMin != null && u.age < b.ageMin) return { v: "fail", msg: `연령 미달 (대상: ${range})` };
  if (b.ageMax != null && u.age > b.ageMax) return { v: "fail", msg: `연령 초과 (대상: ${range})` };
  return { v: "pass", msg: `연령 충족(${u.age}세, 대상 ${range})` };
}

function checkEdu(b: Benefit, u: UserProfile): { v: Verdict; msg: string } {
  if (b.eduStatus.length === 0) return { v: "pass", msg: "학력/재학상태 무관" };
  if (!u.eduStatus) return { v: "unknown", msg: `재학상태 조건(${b.eduStatus.join(", ")}) — 입력 시 확인` };
  return b.eduStatus.includes(u.eduStatus)
    ? { v: "pass", msg: `재학상태 일치(${u.eduStatus})` }
    : { v: "fail", msg: `재학상태 불일치 (대상: ${b.eduStatus.join(", ")})` };
}

function checkGrade(b: Benefit, u: UserProfile): { v: Verdict; msg: string } {
  if (b.grades.length === 0) return { v: "pass", msg: "학년 무관" };
  if (u.grade === 0) return { v: "unknown", msg: `학년 조건(${b.grades.join(", ")}학년) — 입력 시 확인` };
  return b.grades.includes(u.grade)
    ? { v: "pass", msg: `학년 일치(${u.grade}학년)` }
    : { v: "fail", msg: `학년 불일치 (대상: ${b.grades.join(", ")}학년)` };
}

function checkGpa(b: Benefit, u: UserProfile): { v: Verdict; msg: string } {
  if (b.gpaMin == null) return { v: "pass", msg: "성적(평점) 무관" };
  const bScale = b.gpaScale ?? 4.5;
  if (u.gpa == null) return { v: "unknown", msg: `평점 ${b.gpaMin}/${bScale} 이상 대상 — 평점 입력 시 확인` };
  const uScale = u.gpaScale ?? 4.5;
  // 만점 기준이 달라도 비율로 정확히 비교 (예: 3.8/4.3 ↔ 4.0/4.5).
  const need = b.gpaMin / bScale;
  const have = u.gpa / uScale;
  return have >= need
    ? { v: "pass", msg: `평점 충족(${u.gpa}/${uScale} ≥ 요구 ${b.gpaMin}/${bScale})` }
    : { v: "fail", msg: `평점 미달 (요구: ${b.gpaMin}/${bScale} 만점 기준)` };
}

function checkFlags(b: Benefit, u: UserProfile): { v: Verdict; msg: string } {
  if (b.requiredFlags.length === 0) return { v: "pass", msg: "특수자격 무관" };
  const missing = b.requiredFlags.filter((f) => !u.flags.includes(f));
  return missing.length === 0
    ? { v: "pass", msg: `특수자격 충족(${b.requiredFlags.join(", ")})` }
    : { v: "fail", msg: `특수자격 필요: ${missing.join(", ")}` };
}

function checkTargetGroups(b: Benefit, u: UserProfile): { v: Verdict; msg: string } {
  const groups = b.targetGroups ?? [];
  if (groups.length === 0) return { v: "pass", msg: "대상 집단 무관" };
  return u.flags.some((f) => groups.includes(f))
    ? { v: "pass", msg: `대상 집단 해당(${groups.join("/")})` }
    : { v: "fail", msg: `특정 대상 전용 (대상: ${groups.join("/")})` };
}

/** 대학명 느슨한 일치 (예: "서강대" ↔ "서강대학교") */
function univMatches(selected: string, target: string): boolean {
  const norm = (s: string) => s.replace(/대학교|대학|\s|\(.*?\)/g, "");
  const a = norm(selected);
  const b = norm(target);
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
}

function checkUniversity(b: Benefit, u: UserProfile): { v: Verdict; msg: string } {
  if (!b.university) return { v: "pass", msg: "대학 무관" };
  if (!u.univ) return { v: "fail", msg: `${b.university} 재학생 전용 — 대학 선택 시 표시` };
  return univMatches(u.univ, b.university)
    ? { v: "pass", msg: `${b.university} 교내장학금` }
    : { v: "fail", msg: `${b.university} 전용` };
}

/** 학과명 느슨한 일치 (예: "전자공학과" ↔ "전자공학") */
function majorMatches(input: string, dept: string): boolean {
  const norm = (s: string) => s.replace(/학과|학부|전공|공학과|\s/g, "");
  const a = norm(input);
  const b = norm(dept);
  return !!a && !!b && (a.includes(b) || b.includes(a));
}

function checkDepartment(b: Benefit, u: UserProfile): { v: Verdict; msg: string } {
  const depts = b.departments ?? [];
  if (depts.length === 0) return { v: "pass", msg: "학과 무관" };
  if (!u.major) return { v: "fail", msg: `${depts.join("/")} 학과 전용 — 학과 입력 시 표시` };
  return depts.some((d) => majorMatches(u.major, d))
    ? { v: "pass", msg: `${u.major} 해당 학과 장학금` }
    : { v: "fail", msg: `${depts.join("/")} 학과 전용` };
}

/** 계열 매칭 (예: 이공계 전용 = 공학계열·자연계열). 학과보다 한 단계 넓다. */
function checkFaculty(b: Benefit, u: UserProfile): { v: Verdict; msg: string } {
  const fac = b.faculties ?? [];
  if (fac.length === 0) return { v: "pass", msg: "계열 무관" };
  const userFac = resolveFaculty(u.faculty, u.major);
  if (!userFac) return { v: "fail", msg: `${fac.join("/")} 전용 — 계열/학과 입력 시 표시` };
  return fac.includes(userFac)
    ? { v: "pass", msg: `${userFac} 대상 장학금` }
    : { v: "fail", msg: `${fac.join("/")} 전용 (내 계열: ${userFac})` };
}

/** 성별 전용 매칭. genderOnly 있고 사용자 성별과 다르면 제외, 미입력이면 표시(확인). */
function checkGender(b: Benefit, u: UserProfile): { v: Verdict; msg: string } {
  if (!b.genderOnly) return { v: "pass", msg: "성별 무관" };
  if (!u.gender) return { v: "unknown", msg: `${b.genderOnly} 전용 — 성별 입력 시 확인` };
  return u.gender === b.genderOnly
    ? { v: "pass", msg: `${b.genderOnly} 대상 장학금` }
    : { v: "fail", msg: `${b.genderOnly} 전용 (내 성별: ${u.gender})` };
}

export function matchOne(benefit: Benefit, user: UserProfile): MatchResult {
  const checks = [
    checkRegion(benefit, user),
    checkIncome(benefit, user),
    checkAge(benefit, user),
    checkEdu(benefit, user),
    checkGrade(benefit, user),
    checkGpa(benefit, user),
    checkFlags(benefit, user),
    checkTargetGroups(benefit, user),
    checkUniversity(benefit, user),
    checkDepartment(benefit, user),
    checkFaculty(benefit, user),
    checkGender(benefit, user),
  ];

  const passed = checks.filter((c) => c.v === "pass").map((c) => c.msg);
  const unknown = checks.filter((c) => c.v === "unknown").map((c) => c.msg);
  const failed = checks.filter((c) => c.v === "fail").map((c) => c.msg);

  let status: MatchStatus;
  if (failed.length > 0) status = "excluded";
  else if (unknown.length > 0) status = "review";
  else status = "eligible";

  return { benefit, status, passed, unknown, failed };
}

export function matchAll(benefits: Benefit[], user: UserProfile) {
  const results = benefits.map((b) => matchOne(b, user));
  return {
    eligible: results.filter((r) => r.status === "eligible"),
    review: results.filter((r) => r.status === "review"),
    excludedCount: results.filter((r) => r.status === "excluded").length,
  };
}
