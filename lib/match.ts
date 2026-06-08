import type { Benefit, UserProfile, MatchResult, MatchStatus } from "./types";

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

function checkIncome(b: Benefit, u: UserProfile): { v: Verdict; msg: string } {
  if (b.incomeMax == null) {
    return b.incomeNote
      ? { v: "unknown", msg: `소득 조건: ${b.incomeNote} — 확인 필요` }
      : { v: "pass", msg: "소득 조건 무관" };
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

function checkFlags(b: Benefit, u: UserProfile): { v: Verdict; msg: string } {
  if (b.requiredFlags.length === 0) return { v: "pass", msg: "특수자격 무관" };
  const missing = b.requiredFlags.filter((f) => !u.flags.includes(f));
  return missing.length === 0
    ? { v: "pass", msg: `특수자격 충족(${b.requiredFlags.join(", ")})` }
    : { v: "fail", msg: `특수자격 필요: ${missing.join(", ")}` };
}

export function matchOne(benefit: Benefit, user: UserProfile): MatchResult {
  const checks = [
    checkRegion(benefit, user),
    checkIncome(benefit, user),
    checkAge(benefit, user),
    checkEdu(benefit, user),
    checkGrade(benefit, user),
    checkFlags(benefit, user),
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
