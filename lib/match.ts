import type { Benefit, UserProfile, MatchResult, MatchStatus } from "./types";
import { resolveFaculty } from "./faculty";
import { findUnivNames, univLevelOf, univRegionOf } from "./univ-level";

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
  /가계\s*곤란|저소득|소득\s*심사|가(?:정|계)\s*형편|형편이?\s*어(?:려|렵)|생활\s*곤란|생활이?\s*곤란|생활환경[^\n]{0,4}어(?:려|렵)|경제적[^\n]{0,6}어(?:려|렵)|어려운\s*(?:가정|가계|생활|형편|환경|여건|조건)|가정\s*환경[^\n]{0,6}어(?:려|렵)|사회적\s*배려|배려\s*(?:계층|대상)|학비\s*조달|학자금\s*조달|기초\s*생활|국민기초|기초수급|수급\s*(?:가구|자|권자|세대)|복지\s*급여|생계\s*급여|의료\s*급여|주거\s*급여|교육\s*급여|차상위|한부모|긴급\s*복지|소득\s*인정액|법정\s*저소득|기초연금|(?:소득|가계소득|소득구간|지원구간|소득분위)[^\n]{0,4}낮/;

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

/** rawConditionText에서 특정 섹션([자격] 등) 줄만 추출 */
function sectionLine(b: Benefit, tag: string): string {
  return (
    (b.rawConditionText ?? "").split("\n").find((l) => l.startsWith(`[${tag}]`)) ?? ""
  );
}

function checkIncome(b: Benefit, u: UserProfile): { v: Verdict; msg: string } {
  if (b.incomeMax == null) {
    const note = b.incomeNote?.trim();
    if (!note) {
      // 소득 조건 필드는 없지만 이름이 복지급여(생계·의료·주거·교육급여 등)면 수급자 전용 → 상위 소득 제외.
      if (WELFARE_NAME.test(b.name) && u.income >= 7) {
        return { v: "fail", msg: `수급자·저소득 전용 복지급여 — 소득 상위구간(${u.income}분위)은 대상 아님` };
      }
      // 이름 자체가 저소득층 대상 사업(저소득층 요금감면 등) → 상위 소득 제외.
      if (/저소득|차상위|기초생활|수급(?:자|권자|가구)/.test(b.name) && u.income >= 7) {
        return { v: "fail", msg: `저소득층 대상 사업 — 소득 상위구간(${u.income}분위)은 대상 아님` };
      }
      // 소득 필드는 비었지만 원문에 가계곤란·저소득 전용 신호가 있으면 상위 소득 제외.
      // (예: "학자금 조달이 어려운 학생") 우대·가점은 비배타적이므로 제외하지 않는다.
      // 복지로 항목은 자격이 [요약] 한 줄뿐이라(예: "저소득층의 난방비 부담경감") 요약도 함께 본다.
      const jagyeok = `${sectionLine(b, "자격")} ${sectionLine(b, "요약")}`;
      if (u.income >= 7 && MEANS_TESTED.test(jagyeok) && !/우대|가점|가산|우선/.test(jagyeok)) {
        return {
          v: "fail",
          msg: `가계곤란·저소득 대상(자격 요건) — 소득 상위구간(${u.income}분위)은 대상 아님`,
        };
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

// ── 직전학기 성적 요건 ────────────────────────────────────────────────
// 한국장학재단 등 원문 [성적] 항목의 '직전학기 평점 N 이상' 요건을 구조화해 비교한다.
// 문자 등급(B+ 등)·백분위(80점 등)는 학교마다 환산이 달라 추측하지 않고 조건확인으로만 안내한다.
// '직전 학기까지 누계 평점'은 전체 평점 조건이므로 여기서 다루지 않는다(오탐 방지).

interface LastGpaPair {
  min: number;
  scale: number;
}

function extractLastGpaReq(b: Benefit): { pairs: LastGpaPair[]; excerpt: string } | null {
  const raw = b.rawConditionText ?? "";
  if (!raw.includes("[성적]")) return null;
  const line = raw
    .split("\n")
    .find(
      (l) =>
        l.startsWith("[성적]") &&
        /직전\s*학기|직전\s*이수|전\s*학기\s*성적|전학기\s*(?:성적|평점)|최근\s*학기/.test(l) &&
        !/누계|누적/.test(l),
    );
  if (!line) return null;

  // 이수학점 수치("12학점")는 평점과 무관 — 먼저 제거해 혼동 방지
  const text = line.replace(/\d+\s*학점/g, "");
  const pairs: LastGpaPair[] = [];

  // "3.5/4.5" 형태: 기준/만점 쌍
  for (const m of text.matchAll(/([0-4]\.\d{1,2})\s*(?:점)?\s*\/\s*(4\.[035])/g)) {
    pairs.push({ min: Number(m[1]), scale: Number(m[2]) });
  }
  // "4.3만점은 2.6이상" 형태: 다른 만점 기준의 대체 요건
  for (const m of text.matchAll(/(4\.[035])\s*(?:점\s*)?만점\s*(?:기준)?\s*은\s*([0-4]\.\d{1,2})/g)) {
    pairs.push({ min: Number(m[2]), scale: Number(m[1]) });
  }
  // 주 기준: 위 쌍 표기를 걷어낸 뒤 "N.N 이상". 만점 언급이 있으면 그 만점, 없으면 4.5로 본다.
  const cleaned = text
    .replace(/([0-4]\.\d{1,2})\s*(?:점)?\s*\/\s*4\.[035]/g, "")
    .replace(/4\.[035]\s*(?:점\s*)?만점\s*(?:기준)?\s*은\s*[0-4]\.\d{1,2}\s*(?:이상)?/g, "");
  const scaleM = cleaned.match(/(4\.[035])\s*(?:점\s*)?만점/);
  const main = cleaned
    .replace(/4\.[035]\s*(?:점\s*)?만점/g, "")
    .match(/([0-4]\.\d{1,2})[^\d\n]{0,8}이상/);
  if (main) pairs.unshift({ min: Number(main[1]), scale: scaleM ? Number(scaleM[1]) : 4.5 });

  const valid = pairs.filter((p) => p.min >= 0.5 && p.min <= p.scale);
  const excerpt = line.replace(/^\[성적\]\s*/, "").slice(0, 60);
  return { pairs: valid, excerpt };
}

function checkLastGpa(b: Benefit, u: UserProfile): { v: Verdict; msg: string } {
  const req = extractLastGpaReq(b);
  if (!req) return { v: "pass", msg: "직전학기 성적 조건 없음" };
  // 수치화 못 하는 요건(문자 등급·백분위) — 환산 추측 없이 원문으로 확인 안내
  if (req.pairs.length === 0) {
    return { v: "unknown", msg: `직전학기 성적 조건: ${req.excerpt} — 성적표로 확인 필요` };
  }
  const uScale = u.gpaScale ?? 4.5;
  // 사용자 만점 기준과 같은 요건이 있으면 그것을, 없으면 주 기준을 비율로 비교
  const pair = req.pairs.find((p) => p.scale === uScale) ?? req.pairs[0];
  if (u.lastGpa == null) {
    return {
      v: "unknown",
      msg: `직전학기 평점 ${pair.min}/${pair.scale} 이상 대상 — 직전학기 성적 입력 시 확인`,
    };
  }
  const need = pair.min / pair.scale;
  const have = u.lastGpa / uScale;
  return have >= need
    ? { v: "pass", msg: `직전학기 평점 충족(${u.lastGpa}/${uScale} ≥ 요구 ${pair.min}/${pair.scale})` }
    : { v: "fail", msg: `직전학기 평점 미달 (요구: ${pair.min}/${pair.scale} 만점 기준)` };
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
  // 약칭↔정식 정규화: "이화여대"↔"이화여자대학교", "서강대학교"↔"서강대학" 등. 긴 어미부터 제거.
  const norm = (s: string) => s.replace(/여자대학교|여자대학|여대|대학교|대학|\s|\(.*?\)/g, "");
  const a = norm(selected);
  const b = norm(target);
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
}

/** 대학 수준(4년제/전문대/대학원) 매칭 — 전문대 전용이 4년제 사용자에게(또는 반대로) 노출되는 것 방지 */
function checkUnivLevel(b: Benefit, u: UserProfile): { v: Verdict; msg: string } {
  const levels = (b.univLevels ?? []).filter((l) => l !== "특정대학"); // 특정대학은 대학명 매칭의 몫
  if (levels.length === 0) return { v: "pass", msg: "대학 수준 무관" };
  if (!u.univ) return { v: "pass", msg: "" }; // 대학 미선택 — 수준 미상(누락 방지)
  const mine = univLevelOf(u.univ);
  if (!mine) return { v: "pass", msg: "" };
  return levels.includes(mine)
    ? { v: "pass", msg: `대학 수준 해당(${mine})` }
    : { v: "fail", msg: `${levels.join("·")} 재학생 대상 (내 대학: ${mine})` };
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

// ── 원문 기반 자격 필터 ────────────────────────────────────────────────
// 구조화 필드로 못 잡는 "특정 신분·직군·학교급·자치구 전용" 조건을 rawConditionText에서 포착한다.
// 데이터 수만 건을 일일이 구조화할 수 없어, 강한 '전용' 신호에만 반응하는 런타임 텍스트 필터로 보강.
// 보수적 원칙(누락 금지):
//   - 명백히 불가능(대학생인데 고등학생/연구자 전용 등) → fail(제외)
//   - 가능성은 있으나 특수신분 필요(교직원 자녀·자치구 거주 등) → unknown(조건확인으로 분리 + 정확한 사유)

/** 대학(원) 재학생임을 시사하는 신호 — 학교급 전용 판정에 사용 */
function isUniversityStudent(u: UserProfile): boolean {
  return Boolean(u.univ || u.major || u.grade > 0 || /대학/.test(u.eduStatus));
}

// 고등학교/중학교 '재학생' 전용 (대학생은 해당 없음). '졸업/대학 진학' 맥락은 제외(대학생 포함 가능).
const SCHOOL_LEVEL_ONLY =
  /고등학교\s*[1-3]\s*학년|고교\s*[1-3]\s*학년|고[1-3]\b|중학교\s*[1-3]\s*학년|중학생|고등학생|직업계고|특성화고|마이스터고|위탁과정\s*참여/;
// 대학/신입생/재학생을 언급하면 대학생도 대상일 수 있어 제외하지 않는다(누락 방지).
// 흔한 오제외 원인: 대학 신입생 장학금이 평가기준으로 "고등학교 3학년 성적"을 적어두는 경우 →
// 텍스트에 '대학'이 등장하면 고교 전용으로 보지 않는다.
// (주의: "고졸"은 고교 취업연계처럼 고졸자 대상 프로그램 설명에도 흔해 가드로 쓰지 않는다)
const SCHOOL_LEVEL_OK = /대학|신입생|재학생/;

// 의·약학 등 전문 연구자/학술 논문 지원 (학부생, 특히 비(非)의약 계열엔 해당 없음).
const MED_RESEARCH =
  /(?:의\/?약학|의학|약학|치의학|한의학|수의학)\s*(?:연구자|연구|학술|학회)|학술\s*부문\s*(?:각?\s*\d+\s*편|논문)|연구[^\n]{0,30}(?:의학|약학|치의학|한의학|수의학)/;

// 특정 직군 '재직자/연금적용' 전용. 자녀·가족 동반 여부로 fail↔review 분기.
const EMPLOYEE_ONLY =
  /사립학교교직원연금|공무원연금[^\n]{0,6}적용|군인연금[^\n]{0,6}적용|재직\s*(?:중인\s*)?(?:교직원|교원|임직원|직원|근로자|교사|공무원)|(?:현직|재직)\s*(?:교사|교수|공무원|군인|경찰|소방관?)|(?:소방|경찰|교정|관세)\s*공무원|공무원[^\n]{0,15}(?:근속|재직|복무)/;
const EMPLOYEE_FAMILY = /자녀|자제|가족|배우자|직계/;

// 자치구(구/군) 단위 거주 전용 — 시도만 입력한 사용자는 확인 불가(시도는 checkRegion이 처리).
// "북구에 1년 이상 주민등록" 처럼 한 글자 자치구도 잡히도록 1자부터 허용한다
const SGG_RESIDENCE = /([가-힣]{1,4}[구군읍면])\s*(?:에|내)?[^\n]{0,12}?(?:거주|주민등록|관내|주소)/;

// 의·한의·치·약학 대학 전용 — 계열이 다르면 대상이 아니다
const MED_SCHOOL_ONLY =
  /(?:의과|한의과|치과|치의학|약학|수의과)\s*대학|(?:의학|한의학|치의학|약학)\s*전문\s*대학원/;

// 백분위(100점 만점) 성적 요건 — 학교마다 환산이 달라 평점과 직접 비교할 수 없다
const PERCENTILE_GRADE = /(\d{2,3})\s*점[^\n]{0,10}100\s*점\s*만점|100\s*점\s*만점[^\n]{0,10}(\d{2,3})\s*점/;

// 예체능 전공 전용 신호 — "미술관련 학과", "음악 전공" 등. 학과구분 필드가 '제한없음'이라
// faculties로 안 잡히고 [자격] 원문에만 적힌 경우를 보강한다.
const ART_MAJOR_ONLY =
  /(미술|음악|국악|체육|무용|디자인|연극|영화|예술|예체능)[^\n]{0,10}(?:관련\s*)?(?:학과|전공|계열|대학|분야\s*특기|특기생)/;

// 학과명이 직접 적힌 전용 조건(예: "건축학위", "간호학과") — 내 학과와 다르면 확인으로 분리
const NAMED_MAJOR_ONLY = /(건축|간호|법학|신학|수의|치의|해사|항해|기관|조선|항공)\s*(?:학위|학과|전공|계열)/;

// 봉사·멘토 등 사전 활동 이력 요건 — 사용자 입력으로 알 수 없어 확인으로 분리
const PRIOR_ACTIVITY = /\d+\s*개월\s*이상\s*활동|멘토(?:로)?\s*활동|봉사\s*\d+\s*시간\s*이상|활동\s*이력이?\s*있는/;

// "총점의 80% 이상"처럼 백분율로만 제시된 성적 요건 — 평점과 직접 비교 불가
const PERCENT_OF_TOTAL = /총점의?\s*\d{2}\s*%\s*이상/;

// 대학원(석·박사) 과정 전용 — 학부 신호가 함께 없을 때만. (eduStatus 구조화를 못 탄 원문 전용 케이스)
const GRAD_ONLY = /(?:석사|박사|석·박사|석\/박사|대학원)[^\n]{0,12}(?:과정|재학|진학|신입생|학위)/;
const UNDERGRAD_OK = /학부|학사|대학생/;

// 장애 학생 전용 — "재학중인 장애학생/시각장애인/정신장애를 가진" 등.
// '장애 학생은 성적기준 미적용' 같은 예외 조항(장애 인접 문구)은 전용이 아니다.
const DISABILITY_ONLY =
  /(?:시각|청각|지체|발달|중증|정신)?\s*장애(?:인|학생|\s*학생|\s*대학생|\s*당사자)|장애를\s*가진/;
const DISAB_NOT_EXCLUSIVE = /장애[^\n]{0,14}(?:미적용|면제|예외)/;

// 외국인·개발도상국 유학생 전용 (뒤에 '신청 가능/포함' 류가 붙으면 확대 조항이라 전용 아님)
const INTL_STUDENT_ONLY = /(?:외국인|개발도상국[^\n]{0,6}(?:출신)?의?)\s*(?:유학생|대학(?:\(원\))?생|재학생)/;

// 특정 종교·교단 관련 대상 (신학생, 목회자·선교사 자녀, 특정 교단·교회 등록 등) — 확인으로 분리
const RELIGIOUS_ONLY =
  /신학과|신학생|목회자|목양자|교역자|선교사\s*자녀|승려|수녀|교단|감리교|장로교|천주교|불교\s*신자|기독교인|기독교적|불자|정교인|목장교회|교회\s*(?:등록|출석)|세례\s*(?:교인|받은)|새가족\s*(?:수료|과정)|신심이?\s*깊|종립\s*(?:학교|대학)/;

// 특정 단체 회원·조합원(자녀) 전용 — 확인으로 분리
const MEMBER_ONLY =
  /회원\s*가입\s*기간|(?:회원|조합원)[^\n]{0,12}자녀|조합원\s*(?:본인|가족)|조합\s*가입\s*기간|협회\s*회원|연합회\s*회원/;

// 자립준비청년(보호종료)·고립은둔·가족돌봄 청년 등 특수 상황 청년 대상 — 확인으로 분리
const SPECIAL_YOUTH =
  /자립준비청년|보호종료|고립[·\s]?은둔|가족돌봄청년|양육시설|아동복지시설|산하\s*시설|보호\s*시설|조손\s*[·,]?\s*(?:편부|편모)|편부[·,]?\s*편모/;

// 시험 준비생(수험생) 대상, 기존 선발 장학생 계속 지원 — 확인으로 분리
const EXAM_TAKER = /수험\s*생활|수험생/;
const EXISTING_SCHOLAR = /\d+\s*기에?\s*해당하는\s*장학생|기존\s*장학생/;

// "X관련학과" 전공 제한 — 사용자의 학과와 느슨 비교(불일치 시 확인으로 분리, 분류가 애매해 제외는 안 함)
const MAJOR_RESTRICT = /([가-힣]{2,8})\s*관련\s*(?:학과|분야|전공)/;
// 검정고시 출신 전용 — 일반 고교 졸업자는 대상이 아니다(확인으로 분리)
const QUALIFICATION_EXAM = /검정고시\s*(?:출신|합격)/;

// 인문학 전공 전용 — "유럽인문학 주 전공자(어학 문학 철학 등)" 등. '어학연수' 오탐 방지 위해 전공 필수.
const HUM_MAJOR_ONLY =
  /(?:유럽)?인문학[^\n]{0,8}(?:주\s*)?전공|(?:어학|(?<!천)문학|철학|(?<!의)사학)[^\n]{0,4}(?:주\s*)?전공/;

// 사고·순직 유자녀/유족 전용 — 해당 신분은 선택지(플래그)로 표현 불가한 특수 전용.
// 문중·종친회 전용과 같은 원칙: 해당자는 이미 그 재단을 알고 있으므로 일반 사용자에겐 제외.
const BEREAVED_ONLY =
  /유자녀|\(유\)\s*자녀|유가족|유족(?!회)|(?:사망|순직)(?:한|하신)?\s*(?:자|분|사람)?의?\s*자녀|민주화운동[^\n]{0,10}피해/;

// "OO 소재 대학(교) 재학생" — 거주지가 아닌 '학교 소재지' 조건. 사용자의 대학 소재 시도와 비교.
// ── 복지로 [요약] 기반 수혜 대상 판별 ────────────────────────────────
// 복지로(중앙·지자체) 항목은 구조화된 자격 필드가 비어 있고 정보가 [요약] 한 줄뿐이라
// (예: 이름 "연탄쿠폰" → 요약 "저소득층의 난방비 부담경감"), 이름만 보는 규칙으로는 대상을 알 수 없다.
// 요약문이 가리키는 수혜 대상이 대학생 본인과 다른 인구집단이면 걸러낸다.
// 학생·학자금 신호가 있으면(예: "저소득층 대학생에게 근로 기회") 이 게이트를 적용하지 않는다.
const STUDENT_SIGNAL = /대학생|대학교|학부생|대학원생|학자금|등록금|장학|청년/;
const VETERAN_YOYAK =
  /유공자|보훈보상|참전|고엽제|무공수훈|애국지사|전몰|순직군경|위안부|납북|한센인|원폭|사할린|4[·.]?19\s*혁명|5[·.]?18/;
const YOYAK_TARGETS: [RegExp, string][] = [
  [/노숙인|부랑인|출소(?:자|예정자)|보호관찰|갱생보호/, "노숙인·출소자 등"],
  [/입양|가정위탁|위탁아동|학대피해아동|실종아동|성착취|보호대상아동|퇴소\s*(?:청소년|아동)/, "입양·보호아동 등"],
  [/초[·․.]?중[·․.]?고|초등학생|중학생|고등학생|고교생|학교\s*밖\s*청소년|대안교육기관|청소년쉼터|청소년증|위기청소년|아동[·․.]?청소년|학교\s*우유|성장기\s*학생|급식(?:비)?\s*(?:지원|공급)/, "초·중·고 학생"],
  // '출산전후휴가'(근로자 제도)까지 잡히지 않도록 출생·출산은 양육 맥락에서만 인정한다
  [/영유아|영아기?|신생아|미숙아|조산아?|출생\s*아동|출산\s*(?:가정|가구|가족|축하|장려|비용|및\s*양육)|출생\s*축하|첫만남|출생아|산모|산후|임산부|임신부|어린이집|보육교직원|육아휴직|아이돌봄|장난감|양육수당/, "영유아·출산 가구"],
  [/노인|어르신|고령|치매|장기요양|경로(?:당|의\s*달)|연금\s*수급/, "노인·고령자"],
  [/농어민|농업인|어업인|어선원|영농|농가|어가|농촌|어촌|도서\s*지역\s*주민|도서민/, "농어업인·농어촌 주민"],
  // '구직자'는 대학생도 해당할 수 있어 넣지 않는다(청년 구직 지원사업 오제외 방지)
  [/근로자|노동자|사업주|자영업|소상공인|재직자|퇴직자|배달\s*(?:플랫폼|노동)/, "근로자·사업주"],
  [/다자녀|셋째아?\s*(?:이상)?\s*(?:가정|출산)|세\s*자녀\s*이상/, "다자녀 가정"],
];

// [자격] 원문의 추가 전용 조건 — 해당 여부를 사용자 입력으로 알 수 없어 '조건 확인'으로 분리한다.
// 문중(성씨) 장학회 — "풍양조씨", "성주이씨"처럼 본관+성씨 형태를 잡는다
const CLAN_ONLY =
  /[가-힣]{2}(?:김|이|박|최|정|강|조|윤|장|임|한|오|서|신|권|황|안|송|류|유|전|홍|고|문|양|손|배|백|허|남|심|노|하|곽|성|차|주|우|구|민|나|지|엄|채|원|천|방|공|현|함|변|염|여|추|도|소|석|선|설|마|길|연|위|표|명|기|반|왕|금|옥|육|인|맹|제|모)씨|문중|종친회|출신[^\n]{0,4}후손/;
const TENURE_ONLY = /\d+\s*년\s*이상\s*(?:근속|재직|종사)|근속\s*\d+\s*년/;
const ILLNESS_ONLY = /소아암|백혈병|희귀난치|희귀혈액|중증질환\s*(?:경험|진단)/;
const MIGRANT_YOUTH = /중도입국|북한\s*출생|탈북\s*(?:청소년|학생)/;
const CREDIT_COURSE = /(?:융합|연계)\s*\(?(?:연계)?\)?\s*전공|\d+\s*학점\s*이상\s*이수|특정\s*교과목\s*이수/;
const EXAM_PASSER = /\d\s*차\s*시험\s*합격|고시[^\n]{0,6}합격|합격자에\s*한(?:함|하여)/;
const FACULTY_POSITION = /신진교수|교수로\s*임용|박사후|포스닥|연구원으로\s*재직/;
// 입사·대학원 진학을 전제로 한 산학장학생 — 지원 시점·조건이 특수해 확인으로 분리
const CAREER_LINKED = /석사\s*진학\s*필수|졸업\s*후[^\n]{0,10}입사|입사\s*(?:조건|후)[^\n]{0,12}근무|채용\s*연계/;

// "서울/경기 소재 대학"처럼 시도를 나열하는 표기를 통째로 잡는다(하나만 잡으면 오제외가 난다)
const UNIV_LOCATION = /([가-힣][가-힣/·,\s]{1,20})소재(?:한|의)?\s*대학/;
// 소재지 문자열에서 시도를 인식하기 위한 약칭 → 시도 (예: "광주전남통합특별시" → 광주+전남)
const SIDO_TOKENS: [string, string][] = [
  ["서울", "서울특별시"], ["부산", "부산광역시"], ["대구", "대구광역시"], ["인천", "인천광역시"],
  ["광주", "광주광역시"], ["대전", "대전광역시"], ["울산", "울산광역시"], ["세종", "세종특별자치시"],
  ["경기", "경기도"], ["강원", "강원특별자치도"], ["충북", "충청북도"], ["충청북", "충청북도"],
  ["충남", "충청남도"], ["충청남", "충청남도"], ["전북", "전북특별자치도"], ["전라북", "전북특별자치도"],
  ["전남", "전라남도"], ["전라남", "전라남도"], ["경북", "경상북도"], ["경상북", "경상북도"],
  ["경남", "경상남도"], ["경상남", "경상남도"], ["제주", "제주특별자치도"],
];

function rawText(b: Benefit): string {
  return `${b.name} ${b.rawConditionText ?? ""} ${b.description ?? ""}`;
}

/** 대학명 스캔 대상 텍스트. 대상을 한정하는 섹션만 본다.
 *  - [성적]·[제출서류]·[선발방법]은 "1순위 대학교: 서울대/연세대…(우선선발)", "소속 대학 총장 추천서"처럼
 *    대상 제한이 아닌 맥락으로 대학명을 언급해 오제외를 부른다.
 *  - '우대·우선선발·가점' 주변 문구도 배타적 조건이 아니므로 걷어낸다. */
function univScanText(b: Benefit): string {
  return (b.rawConditionText ?? "")
    .split("\n")
    .filter((l) => /^\[(?:자격|대상)\]/.test(l))
    .join("\n")
    .replace(/[^\n]{0,30}(?:우대|우선\s*선발|가점|가산)[^\n]{0,60}/g, " ")
    .replace(/[^\n]{0,60}제외/g, " ")
    // "(가천대 기준)"처럼 학교별 표기 기준을 밝히는 괄호는 대상 제한이 아니다
    .replace(/\([^)]{0,12}기준\)/g, " ");
}

/** "지질/지구물리/자원공학 등 자원개발 유관 전공자"처럼 전공을 나열해 한정하는 표현 */
// 앞의 전공 나열을 통째로 잡아야 하므로 탐욕적으로 매칭한다(게으르게 하면 "이공계열"이 "이"로 잘림).
// 문자 클래스가 '['를 배제해 섹션 태그를 넘어가지 않는다.
const MAJOR_ONLY = /([^\n[\]]{2,45})전공자/;

/** "해사대학 항해계열 재학생"처럼 계열로 한정하는 표현 */
const FACULTY_ONLY = /([가-힣]{2,8})\s*계열\s*(?:재학생|학생|전공|만\b)/;

/** [선발인원]에 학과를 지정한 경우(예: "화학과 2명 화학공학과 2명") */
const DEPT_QUOTA = /([가-힣]{2,10}?(?:학과|학부))\s*\d+\s*명/g;

/** 나열된 전공 문구에 내 학과·계열이 포함되는지. 계열 단어(이공계 등)도 함께 본다 */
function majorPhraseMatches(phrase: string, u: UserProfile): boolean {
  if (/무관|제한\s*없|모든\s*전공|전\s*학과/.test(phrase)) return true;
  const fac = resolveFaculty(u.faculty, u.major);
  // 계열 전체를 가리키는 표현만 통과시킨다. "자원공학"처럼 특정 전공명에 든 '공학'까지
  // 이공계 전체로 보면 다른 학과 전용 장학금이 그대로 통과해버린다.
  if (fac === "공학계열" || fac === "자연계열") {
    if (/이공\s*계|이공계열|공과\s*대학|자연과학\s*대학|과학기술\s*계열|이과\s*계열/.test(phrase)) {
      return true;
    }
  }
  return phrase
    .split(/[\/·,]|\s+/)
    .filter((t) => t.length >= 2)
    .some((t) => majorMatches(u.major, t.replace(/(?:학과|학부|전공|계열)$/, "")));
}

function checkRawEligibility(b: Benefit, u: UserProfile): { v: Verdict; msg: string } {
  const text = rawText(b);

  // 1) 고/중학생·직업계고·위탁과정 전용 — 대학(원)생은 제외
  if (isUniversityStudent(u) && SCHOOL_LEVEL_ONLY.test(text) && !SCHOOL_LEVEL_OK.test(text)) {
    return { v: "fail", msg: "고교·중학생(직업계고/위탁과정 등) 대상 — 대학생은 해당 없음" };
  }

  // 1-1) 백분위·백분율 성적 요건 — 평점과 환산이 부정확해 단정하지 않고 확인으로 안내
  const seongjeok = sectionLine(b, "성적");
  const pct = seongjeok.match(PERCENTILE_GRADE);
  if (pct) {
    return { v: "unknown", msg: `백분위 성적 요건(${pct[1] ?? pct[2]}점/100점) — 환산 확인 필요` };
  }
  if (PERCENT_OF_TOTAL.test(seongjeok)) {
    return { v: "unknown", msg: "백분율(총점 대비) 성적 요건 — 환산 확인 필요" };
  }

  // 2) 의·약학 연구자/학술 논문 지원 — 계열을 알고 의약·보건이 아니면 제외, 모르면 확인
  // "대학(… 의학전문대학원 포함)에 재학중인 자"처럼 대상을 넓히는 문구는 전용 조건이 아니다
  const medLine = sectionLine(b, "자격");
  const medM = medLine.match(MED_SCHOOL_ONLY);
  if (medM) {
    const at = (medM.index ?? 0) + medM[0].length;
    const around = medLine.slice(Math.max(0, at - 40), at + 26);
    // "의과/약학대학 소속이 아닌 재학생"(부정문), "(원주의과대학은 …까지 지원 가능)"(확대 조항)은 전용이 아니다
    if (!/포함|또는|및\s*일반|소속이?\s*아닌|제외|지원\s*가능|까지/.test(around)) {
      const fac = resolveFaculty(u.faculty, u.major);
      if (fac && fac !== "의약·보건계열") {
        return { v: "fail", msg: `의·한의·치·약학 대학 대상 — 내 계열(${fac})은 해당 없음` };
      }
      return { v: "unknown", msg: "의·한의·치·약학 대학 대상 — 해당 시에만" };
    }
  }
  if (MED_RESEARCH.test(text)) {
    const fac = resolveFaculty(u.faculty, u.major);
    if (fac && fac !== "의약·보건계열") {
      return { v: "fail", msg: `의·약학 연구자/학술 대상 — 내 계열(${fac})은 해당 없음` };
    }
    return { v: "unknown", msg: "의·약학 연구자·학술 논문 대상 — 해당 시에만" };
  }

  // 3) 특정 직군 재직자 전용 — 자녀·가족 포함이면 확인(자녀일 수 있음), 본인 전용이면 제외
  if (EMPLOYEE_ONLY.test(text)) {
    if (EMPLOYEE_FAMILY.test(text)) {
      return { v: "unknown", msg: "특정 직군(교직원·공무원 등) 본인·자녀 전용 — 해당 시에만" };
    }
    if (isUniversityStudent(u)) {
      return { v: "fail", msg: "특정 직군 재직자 본인 전용 — 대학생은 해당 없음" };
    }
  }

  // 4) 예체능(미술·음악·체육 등) 전공 전용 — [자격] 원문 기반. 계열을 알면 판정, 모르면 확인.
  //    '우대/가점'은 비배타적, '제외'는 반대 의미라 건드리지 않는다.
  const jagyeok = sectionLine(b, "자격").replace(/[^\n]{0,10}(?:우대|가점|가산)/g, "");
  const artM = jagyeok.match(ART_MAJOR_ONLY);
  const artAfter = artM ? jagyeok.slice((artM.index ?? 0) + artM[0].length).slice(0, 6) : "";
  if (artM && !artAfter.includes("제외")) {
    const fac = resolveFaculty(u.faculty, u.major);
    if (fac && fac !== "예체능계열") {
      return { v: "fail", msg: `예체능(${artM[1]}) 전공 대상 — 내 계열(${fac})은 해당 없음` };
    }
    return { v: "unknown", msg: `예체능(${artM[1]}) 전공 대상 — 해당 시에만` };
  }

  // 4-1) 인문학(어학·문학·철학 등) 전공 전용 — 같은 방식
  if (HUM_MAJOR_ONLY.test(jagyeok)) {
    const fac = resolveFaculty(u.faculty, u.major);
    if (fac && fac !== "인문계열") {
      return { v: "fail", msg: `인문학(어학·문학·철학 등) 전공 대상 — 내 계열(${fac})은 해당 없음` };
    }
    return { v: "unknown", msg: "인문학(어학·문학·철학 등) 전공 대상 — 해당 시에만" };
  }

  // 5) 사고·순직 유자녀/유족 전용 — 보훈·장애 플래그 보유자에겐 확인으로, 그 외엔 제외
  if (BEREAVED_ONLY.test(jagyeok)) {
    const related =
      u.flags.includes("국가보훈대상자") ||
      (u.flags.includes("장애인(본인/가족)") && /장애/.test(jagyeok));
    return related
      ? { v: "unknown", msg: "사고·순직 유자녀 등 유족 대상 — 해당 시에만" }
      : { v: "fail", msg: "사고·순직 유자녀·유족 전용 — 해당 없음" };
  }

  // 5-1) 대학원(석·박사) 과정 전용 — [자격]에 학부 신호 없이 대학원 과정만 요구하는 경우.
  //      "대학(… 의학전문대학원 포함)에 재학" 처럼 대상을 넓히는 문구는 전용이 아니다.
  const gradM = jagyeok.match(GRAD_ONLY);
  if (gradM && !UNDERGRAD_OK.test(jagyeok) && u.eduStatus !== "대학원생") {
    const after = jagyeok.slice((gradM.index ?? 0) + gradM[0].length).slice(0, 12);
    if (!/포함|또는/.test(gradM[0] + after)) {
      if (u.eduStatus) return { v: "fail", msg: "대학원(석·박사) 과정 전용 — 학부생은 해당 없음" };
      return { v: "unknown", msg: "대학원(석·박사) 과정 대상 — 해당 시에만" };
    }
  }

  // 5-2) 장애 학생 전용 — 플래그 미보유 시 제외. '미적용·면제' 등 예외 조항 문구는 전용이 아님
  if (
    DISABILITY_ONLY.test(jagyeok) &&
    !DISAB_NOT_EXCLUSIVE.test(jagyeok) &&
    !u.flags.includes("장애인(본인/가족)")
  ) {
    return { v: "fail", msg: "장애 학생 대상 — 해당 없음(특수자격 미선택)" };
  }

  // 5-3) 외국인·개발도상국 유학생 전용 — '신청 가능/포함' 류 확대 조항이면 전용 아님
  const intlM = jagyeok.match(INTL_STUDENT_ONLY);
  if (intlM) {
    const after = jagyeok.slice((intlM.index ?? 0) + intlM[0].length).slice(0, 20);
    if (!/신청\s*가능|지원\s*가능|포함/.test(after)) {
      return { v: "fail", msg: "외국인 유학생 대상 — 해당 없음" };
    }
  }

  // 5-4) 특정 종교·교단 / 단체 회원 관련 대상 — 해당 여부를 알 수 없어 확인으로 분리
  // 종교 요건은 [제출서류]에만 드러나기도 한다(예: "담당 목양자 추천서")
  if (RELIGIOUS_ONLY.test(`${jagyeok} ${sectionLine(b, "제출서류")}`)) {
    return { v: "unknown", msg: "특정 종교·교단 관련 대상 — 해당 시에만" };
  }
  if (MEMBER_ONLY.test(jagyeok)) {
    return { v: "unknown", msg: "특정 단체 회원·조합원(자녀) 대상 — 해당 시에만" };
  }

  // 5-5) 특수 상황 청년(자립준비·고립은둔·가족돌봄)·수험생·기존 장학생 계속지원 — 확인으로 분리
  if (SPECIAL_YOUTH.test(`${b.name} ${jagyeok}`)) {
    return { v: "unknown", msg: "자립준비·고립은둔·가족돌봄 청년 대상 — 해당 시에만" };
  }
  if (EXAM_TAKER.test(jagyeok)) {
    return { v: "unknown", msg: "시험 준비생(수험생) 대상 — 해당 시에만" };
  }
  if (EXISTING_SCHOLAR.test(jagyeok)) {
    return { v: "unknown", msg: "기존 선발 장학생(계속 지원) 대상 — 해당 시에만" };
  }

  // 5-6) "X관련학과" 전공 제한 — 입력한 학과와 안 맞으면 확인으로 분리(분류가 애매해 제외는 안 함)
  const mjr = jagyeok.match(MAJOR_RESTRICT);
  if (mjr && u.major && !majorMatches(u.major, mjr[1])) {
    return { v: "unknown", msg: `${mjr[1]} 관련 학과 대상 — 해당 시에만` };
  }

  // 5-7) 특정 대학 전용 — 실제 대학명이 적혀 있고 내 대학이 그중에 없으면 제외.
  //      '국내 대학'·'4년제 대학' 같은 일반 표현은 전국대학 데이터에 없어 걸리지 않는다.
  //      대학명은 [자격] 밖(금액·성적 설명 등)에도 나오므로 원문 전체를 보되,
  //      제출서류·선발방법("소속 대학 총장 추천서" 등)은 대상 제한이 아니라 제외한다.
  const namedUnivs = findUnivNames(univScanText(b));
  if (namedUnivs.length > 0 && u.univ && !namedUnivs.some((n) => univMatches(u.univ, n))) {
    return { v: "fail", msg: `${namedUnivs.slice(0, 3).join("·")} 재학생 대상 (내 대학: ${u.univ})` };
  }

  // 5-7-1) "OO 전공자" 전용 — 나열된 전공 중 내 학과와 맞는 게 없으면 확인으로 분리.
  //        전공 분류가 학교마다 달라 단정(제외)하지 않는다.
  const majorOnly = jagyeok.match(MAJOR_ONLY);
  if (majorOnly && u.major && !majorPhraseMatches(majorOnly[1], u)) {
    return { v: "unknown", msg: `${majorOnly[1].trim().slice(0, 20)} 전공자 대상 — 해당 시에만` };
  }
  const facOnly = jagyeok.match(FACULTY_ONLY);
  if (facOnly && u.major && !majorPhraseMatches(`${facOnly[1]}계열`, u)) {
    return { v: "unknown", msg: `${facOnly[1]}계열 대상 — 해당 시에만` };
  }

  // 5-7-2) [선발인원]에 학과별 인원을 못박은 경우 — 그 학과가 아니면 대상이 아니다
  const quotaDepts = [...sectionLine(b, "선발인원").matchAll(DEPT_QUOTA)].map((m) => m[1]);
  if (quotaDepts.length > 0 && u.major && !quotaDepts.some((d) => majorMatches(u.major, d))) {
    return { v: "unknown", msg: `${quotaDepts.slice(0, 3).join("·")} 선발 — 해당 시에만` };
  }

  // 5-8) 사용자 입력으로 알 수 없는 전용 조건 — '조건 확인'으로 분리해 '받을 수 있음'에서 뺀다
  const narrowed: [RegExp, string][] = [
    [CLAN_ONLY, "특정 문중·성씨 후손 대상"],
    [TENURE_ONLY, "특정 기관 장기 근속자(자녀) 대상"],
    [ILLNESS_ONLY, "소아암·희귀난치질환 경험자 대상"],
    [MIGRANT_YOUTH, "중도입국·북한출생 학생 대상"],
    [FACULTY_POSITION, "교수·연구자 대상"],
    [EXAM_PASSER, "시험 합격자 대상"],
    [CREDIT_COURSE, "특정 전공·교과목 이수자 대상"],
    [QUALIFICATION_EXAM, "검정고시 출신 학생 대상"],
    [PRIOR_ACTIVITY, "사전 활동(멘토·봉사) 이력 요건"],
  ];
  const namedMajor = jagyeok.match(NAMED_MAJOR_ONLY);
  if (namedMajor && u.major && !majorMatches(u.major, namedMajor[1])) {
    return { v: "unknown", msg: `${namedMajor[1]} 전공 대상 — 해당 시에만` };
  }
  if (CAREER_LINKED.test(`${jagyeok} ${sectionLine(b, "자격제한")}`)) {
    return { v: "unknown", msg: "입사·대학원 진학 연계 산학장학생 — 해당 시에만" };
  }
  for (const [re, label] of narrowed) {
    if (re.test(jagyeok)) return { v: "unknown", msg: `${label} — 해당 시에만` };
  }

  // 6) 자치구(구/군) 거주 전용 — 시도만 입력한 사용자는 확인 필요(누락 방지로 제외하지 않음)
  const m = text.match(SGG_RESIDENCE);
  if (m) {
    return { v: "unknown", msg: `${m[1]} 거주자 대상 — 해당 자치구 거주 시에만` };
  }

  return { v: "pass", msg: "추가 자격조건 없음" };
}

/** "OO 소재 대학 재학생" — 학교 소재지 조건. 사용자가 선택한 대학의 소재 시도와 비교한다.
 *  국내/전국 소재는 조건이 아니고, 시군 단위(예: "아산시 소재")는 시도 판별이 안 되므로 확인으로만 안내. */
function checkUnivLocation(b: Benefit, u: UserProfile): { v: Verdict; msg: string } {
  const src = `${sectionLine(b, "자격")} ${sectionLine(b, "지역거주")}`;
  // "수도권을 제외한 지역 소재 대학" — 수도권(서울·인천·경기) 대학 사용자는 제외
  if (/수도권(?:을|은)?\s*제외/.test(src) && u.univ) {
    const myRegion = univRegionOf(u.univ);
    if (myRegion && ["서울특별시", "인천광역시", "경기도"].includes(myRegion)) {
      return { v: "fail", msg: `수도권 제외 지역 대학 대상 (내 대학 소재: ${myRegion})` };
    }
  }
  const m = src.match(UNIV_LOCATION);
  if (!m) return { v: "pass", msg: "" };
  const loc = m[1];
  if (/국내|국외|해외|외국|전국/.test(loc)) return { v: "pass", msg: "" };
  // 수도권 = 서울·인천·경기
  const mentioned = /수도권/.test(loc)
    ? ["서울특별시", "인천광역시", "경기도"]
    : [...new Set(SIDO_TOKENS.filter(([tok]) => loc.includes(tok)).map(([, sido]) => sido))];
  if (mentioned.length === 0) {
    return { v: "unknown", msg: `${loc} 소재 대학 재학생 대상 — 해당 시에만` };
  }
  if (!u.univ) {
    return { v: "unknown", msg: `${loc} 소재 대학 재학생 대상 — 대학 선택 시 확인` };
  }
  const myRegion = univRegionOf(u.univ);
  if (!myRegion) {
    return { v: "unknown", msg: `${loc} 소재 대학 재학생 대상 — 해당 시에만` };
  }
  return mentioned.includes(myRegion)
    ? { v: "pass", msg: `대학 소재지 해당(${myRegion})` }
    : { v: "fail", msg: `${loc} 소재 대학 재학생 대상 (내 대학 소재: ${myRegion})` };
}

// ── 성별·생애주기 게이팅 ────────────────────────────────────────────────
// 복지로 등 전국민 복지에는 특정 인구집단(노인·영유아·임산부·외국인·장애인 등) 전용이 많다.
// 이름(name)에 강한 전용 신호가 있고 사용자가 그 집단이 아니면 제외/조건확인으로 정리한다.
//   - 성별 신체조건(임신·출산·산모) → 남성 제외
//   - 플래그로 매핑되는 집단(외국인/장애/한부모/다문화/북한이탈) → 해당 플래그 미보유 시 제외
//     (특수자격을 체크 안 했다 = 본인이 그 집단이 아니라고 신고한 것 → 기존 targetGroups 동작과 일관)
//   - 노인·고령 → 대학(원)생/젊은 사용자면 제외
//   - 영유아·난임 → 부모일 수 있어 제외 대신 조건확인(누락 방지)
// 학과·전공 맥락(노인복지학과 등)이나 awareness 프로그램은 오제외하지 않도록 가드를 둔다.

const ACADEMIC_GUARD = /학과|학부|전공|복지학|요양보호사\s*양성|인식\s*개선|예방\s*교육|이해\s*교육/;

function youngUser(u: UserProfile): boolean {
  return isUniversityStudent(u) || (u.age != null && u.age < 50);
}

function checkLifeStageGender(b: Benefit, u: UserProfile): { v: Verdict; msg: string } {
  // 운영기관 이름이 대상 집단을 그대로 말해주는 경우가 많다(예: 남북하나재단=북한이탈주민,
  // OO총동창회=해당 대학 동문). 장학금명만 봐서는 알 수 없어 기관명도 함께 판단한다.
  const name = `${b.name} ${b.provider}`;
  const text = rawText(b);

  if (/총?동창회|동문회/.test(b.provider)) {
    return { v: "unknown", msg: "해당 학교 동문·재학생 대상 — 해당 시에만" };
  }

  // 1) 임신·출산·산모(신체조건) — 남성 제외. 난임/영유아는 부모 가능성으로 제외 안 함.
  if (/임신|출산|산모|임산부|모성/.test(name) && !/난임|영유아|영아|기저귀|분유/.test(name)) {
    if (u.gender === "남성") return { v: "fail", msg: "임신·출산 지원 — 남성은 해당 없음" };
    return { v: "pass", msg: "" };
  }
  // 2) 여성 전용/여성 위기지원 — 남성 제외
  if (/여성긴급|위기여성|미혼모|여성\s*전용|성매매[^\n]{0,6}피해|여성[^\n]{0,4}쉼터/.test(text) && u.gender === "남성") {
    return { v: "fail", msg: "여성 대상 지원 — 남성은 해당 없음" };
  }
  // 2-1) 이름이 여성 대상인 사업(여성청소년·여성어업인·여성기업 등) — 남성 제외
  if (/(?<!부)여성|여대생/.test(name) && u.gender === "남성" && !ACADEMIC_GUARD.test(name)) {
    return { v: "fail", msg: "여성 대상 지원 — 남성은 해당 없음" };
  }

  // 3) 플래그 매핑 집단 — 해당 플래그 미보유 시 제외 (이름 기반 강한 신호 + 학과 가드)
  const has = (f: string) => u.flags.includes(f);
  if (/외국인|국내체류외국인|이주민|결혼이민|이주노동/.test(name) && !has("다문화가족")) {
    return { v: "fail", msg: "외국인·이주민 대상 — 해당 없음" };
  }
  if (/북한이탈주민|새터민|남북하나재단|탈북/.test(name) && !has("북한이탈주민")) {
    return { v: "fail", msg: "북한이탈주민 대상 — 해당 없음(특수자격 미선택)" };
  }
  if (/다문화|이주배경/.test(name) && !has("다문화가족") && !ACADEMIC_GUARD.test(name)) {
    return { v: "fail", msg: "다문화가족 대상 — 해당 없음(특수자격 미선택)" };
  }
  if (/장애인|장애아|장애\s*대학생|장애학생|장애입양|중증장애|발달장애|장애수당|경증장애/.test(name) && !has("장애인(본인/가족)") && !ACADEMIC_GUARD.test(name)) {
    return { v: "fail", msg: "장애인 대상 — 해당 없음(특수자격 미선택)" };
  }
  if (/한부모|미혼모|조손\s*가정|모자가정|부자가정/.test(name) && !has("한부모가족")) {
    return { v: "fail", msg: "한부모·조손가정 대상 — 해당 없음(특수자격 미선택)" };
  }

  // 3-1) 이름·요약이 보훈·유공자 대상 — 보훈 플래그 미보유 시 제외
  const yoyak = sectionLine(b, "요약");
  if (/보훈|유공자|참전/.test(name) && !has("국가보훈대상자")) {
    return { v: "fail", msg: "국가보훈대상자·유공자 대상 — 해당 없음(특수자격 미선택)" };
  }
  if (VETERAN_YOYAK.test(yoyak) && !has("국가보훈대상자")) {
    return { v: "fail", msg: "국가보훈대상자·특수피해자 대상 — 해당 없음(특수자격 미선택)" };
  }
  // 3-1-1) 요약이 특정 시도 주민(도민·시민) 대상인데 거주지가 다르면 제외 (예: "취약 경남도민 대상")
  const resM = yoyak.match(/([가-힣]{2,4})(?:도민|시민|군민)/);
  if (resM && u.region) {
    const target = SIDO_TOKENS.filter(([t]) => resM[1].includes(t)).map(([, s]) => s);
    if (target.length > 0 && !target.includes(u.region)) {
      return { v: "fail", msg: `${resM[1]} 지역 주민 대상 (내 거주지: ${u.region})` };
    }
  }
  // 3-2) 직업군 전용 사업(농어업인·소상공인·자영업 등) — 학생에겐 제외
  if (/농업인(?!재)|어업인(?!재)|임업인|축산농|귀농|귀어|소상공인|자영업/.test(name) && youngUser(u)) {
    return { v: "fail", msg: "농어업인·소상공인 등 직업군 대상 — 대학생은 해당 없음" };
  }
  // 3-3) 장기복무 제대군인(10년 이상 복무) 대상 — 대학생에겐 제외. 일반 제대군인은 확인으로만(복학생 가능)
  if (/장기복무[^\n]{0,4}제대군인/.test(name) && youngUser(u)) {
    return { v: "fail", msg: "장기복무 제대군인 대상 — 해당 없음" };
  }
  if (/제대군인/.test(name)) {
    return { v: "unknown", msg: "제대군인 대상 — 해당 시에만" };
  }
  // 3-4) 산재·일반 근로자 대상 사업 — 재직·근로 중인 경우만 해당(근로장학은 제외 대상 아님)
  if (/산재근로자|산재\s*보험/.test(name) || (/근로자/.test(name) && !/장학/.test(name))) {
    return { v: "unknown", msg: "근로자(재직·산재 등) 대상 — 해당 시에만" };
  }

  // 4) 노인·고령·중장년 — 젊은 사용자면 제외 (학과/요양보호사 양성 등은 가드로 제외)
  if (/노인|어르신|고령자?|경로(?:당|우대)|65세\s*이상|장기요양|치매|중장년/.test(name) && youngUser(u) && !ACADEMIC_GUARD.test(name)) {
    return { v: "fail", msg: "노인·중장년 등 고연령 대상 — 대학생은 해당 없음" };
  }

  // 4-1) 초·중·고 학생(자녀) 가구 대상(입학지원금·교복 등) — 부모일 수 있어 확인으로만
  if (/초등학생|중고교생|중·고교|교복/.test(name) && youngUser(u) && !ACADEMIC_GUARD.test(name)) {
    return { v: "unknown", msg: "초·중·고 학생(자녀) 가구 대상 — 해당 시에만" };
  }

  // 5) 영유아·아동(수령 대상이 아동) — 학생-부모 가능성으로 조건확인
  if (/영유아|영아|어린이집|보육료|아동수당|기저귀|분유/.test(name) && !ACADEMIC_GUARD.test(name)) {
    return { v: "unknown", msg: "영유아·아동 양육 가구 대상 — 해당 시에만" };
  }

  // 6) 복지로 요약문 기반 대상 판별 — 이름만으로는 대상을 알 수 없는 복지서비스를 걸러낸다.
  //    학생·청년 신호가 있으면 대학생에게도 해당할 수 있으므로 적용하지 않는다(누락 방지).
  //    사업명에만 '청년'이 있고 요약엔 없는 경우가 있어 이름까지 함께 본다.
  //    적용 범위는 복지로([요약] 보유)로 한정한다. 온통청년 설명문까지 넓히면
  //    청년 인재양성·일자리 사업이 '농어업인/근로자' 문구 하나로 잘못 제외된다(실측 확인).
  const yoyakScope = `${b.name} ${yoyak}`;
  if (yoyak && !STUDENT_SIGNAL.test(yoyakScope) && !ACADEMIC_GUARD.test(yoyak) && isUniversityStudent(u)) {
    for (const [re, label] of YOYAK_TARGETS) {
      if (re.test(yoyakScope)) {
        return { v: "fail", msg: `${label} 대상 복지서비스 — 대학생 본인은 해당 없음` };
      }
    }
  }

  return { v: "pass", msg: "생애주기·성별 조건 없음" };
}

/** 자격 판정 근거가 아예 없는 항목은 "받을 수 있음"으로 단정하지 않는다.
 *  복지로(중앙·지자체) 복지서비스는 구조화된 자격 필드가 전부 비어 있고 정보가 [요약] 한 줄뿐이라,
 *  그대로 두면 대학생과 무관한 서비스(우유급식·난청검사 등)까지 "받을 수 있음"으로 올라온다.
 *  엔진 원칙(정보 부족 = unknown)에 맞춰 조건 확인으로 분류한다. */
function checkEvidence(b: Benefit): { v: Verdict; msg: string } {
  if (!b.id.startsWith("bokjiro")) return { v: "pass", msg: "" };
  const structured =
    b.incomeMax != null ||
    b.ageMin != null ||
    b.ageMax != null ||
    b.eduStatus.length > 0 ||
    b.grades.length > 0 ||
    b.requiredFlags.length > 0 ||
    b.targetGroups.length > 0 ||
    Boolean(b.incomeNote) ||
    Boolean(b.university);
  if (structured) return { v: "pass", msg: "" };
  return {
    v: "unknown",
    msg: "복지 서비스 — 대상 요건이 요약뿐이라 공식 페이지에서 확인 필요",
  };
}

/** [지역거주] 원문 섹션 — 구조화된 regions로 안 잡히는 거주 요건을 판정한다.
 *  시도명이 있으면 거주지와 비교하고, 시군구·"관내"처럼 시도를 특정할 수 없으면 확인으로만 안내한다.
 *  "OO 소재 대학"은 학교 소재지 조건이라 checkUnivLocation의 몫이므로 여기선 건드리지 않는다. */
function checkResidence(b: Benefit, u: UserProfile): { v: Verdict; msg: string } {
  const line = sectionLine(b, "지역거주");
  if (!line || /기관확인필요|해당없음|제한없음|무관/.test(line)) return { v: "pass", msg: "" };
  if (/소재(?:한|의)?\s*(?:대학|학교|고등학교)/.test(line)) return { v: "pass", msg: "" };
  // "출생지·출신고교·재학대학 중 하나 이상" 같은 택1 요건은 거주 조건이 아니다
  if (/하나\s*이상\s*충족|중\s*하나|출생한\s*자|출신\s*(?:고교|고등학교|자)/.test(line)) {
    return { v: "unknown", msg: "지역 연고(거주·출생·출신학교) 요건 — 해당 시에만" };
  }

  const sidos = [...new Set(SIDO_TOKENS.filter(([tok]) => line.includes(tok)).map(([, s]) => s))];
  if (sidos.length > 0) {
    if (!u.region) return { v: "unknown", msg: `${sidos.join("·")} 거주자 대상 — 거주지 선택 시 확인` };
    return sidos.includes(u.region)
      ? { v: "pass", msg: `거주지 조건 해당(${u.region})` }
      : { v: "fail", msg: `${sidos.join("·")} 거주자 대상 (내 거주지: ${u.region})` };
  }
  if (/전국|국내|대한민국/.test(line)) return { v: "pass", msg: "" };
  if (/관내|주변\s*영향\s*지역|소음\s*(?:대책|피해)|인근\s*지역|[가-힣]{2,5}[시군구읍면동]\s*(?:에|내)?/.test(line)) {
    return { v: "unknown", msg: "특정 시·군·구 거주자 대상 — 해당 지역 거주 시에만" };
  }
  return { v: "pass", msg: "" };
}

// ── 원문 학년 요건 ────────────────────────────────────────────────────
// [자격]에 "1학년 재학생"·"3학년~4학년"처럼 학년이 명시된 항목은 grades 필드로 구조화되지 않아
// 그대로 두면 학년이 다른 사용자에게도 노출된다. 확실히 읽히는 표현만 판정한다(오제외 방지).
// 연도 표기("2025~2026학년도")를 학년 범위로 오독하지 않도록 앞자리 숫자를 배제한다.
// "2학년 1학기~4학년 2학기"처럼 학기가 끼어드는 범위 표기도 함께 인식한다.
const GRADE_RANGES = [
  /(?<!\d)(\d)\s*학년(?:\s*\d\s*학기)?\s*[~∼-]\s*(\d)\s*학년/,
  /(?<!\d)(\d)\s*(?:학년)?\s*[~∼-]\s*(\d)\s*학년/,
];
const GRADE_MIN = /(?<!\d)(\d)\s*학년\s*이상/;
// "2·3·4학년", "2/3/4학년"처럼 나열된 학년 — 하나만 잡으면 나머지가 대상에서 빠진다
const GRADE_ENUM = /(?<!\d)((?:\d\s*(?:학년)?\s*[·,/]\s*)+\d)\s*학년/g;
// 단일 학년 지정 표현들. "5학기 또는 6학기(3학년)"처럼 괄호로 학년을 밝히는 형태도 포함한다.
const GRADE_EXACT_PATTERNS = [
  /(?<!\d)(\d)\s*학년(?:\s*\d\s*학기)?[^\n]{0,12}?(?:재학|재적|등록|신규\s*선발|선발\s*기준)/g,
  /(?<!\d)(\d)\s*학년생/g,
  /\((\d)\s*학년\)/g,
  /(?<!\d)(\d)\s*학년\s*(?:기준|대상)/g,
  /(?<!\d)(\d)\s*학년(?=\s*(?:또는|혹은|및|,|·)\s*\d\s*학년)/g,
];
// "3학년 1학기 진학 예정자"의 대상은 지금 2학년인 학생이다 — 진급 전후 두 학년 모두 인정한다
const GRADE_ADVANCING = /(?<!\d)(\d)\s*학년(?:\s*\d\s*학기)?[^\n]{0,12}?(?:진급|진학)/g;

// 최종 학년/졸업 예정 조건을 뒤집어 읽지 않기 위한 가드.
// "졸업예정자 제외", "학년 제한 없음", "1~졸업학년", "졸업예정자 우선 지원"은 전용 조건이 아니다.
const NOT_FINAL_YEAR =
  /졸업\s*예정자?\s*제외|학년\s*제한\s*없|모든\s*학년|전\s*학년|[\d]\s*[~∼-]\s*졸업\s*학년|졸업\s*예정[^\n]{0,10}(?:우선|우대)|이내\s*졸업/;
// 최종 학년(졸업반) 전용 — 2학년 등 저학년은 대상이 아니다
const FINAL_YEAR_ONLY = /최종\s*학년|마지막\s*학년|졸업\s*학년(?!\s*[~∼-])/;
// 졸업 예정자 대상 — "N학기 이내 졸업 가능자"처럼 잔여학기 조건일 수도 있어 단정하지 않는다
const GRADUATION_SOON = /졸업\s*(?:예정|가능)자/;
// 대학 진학 예정자(고교 졸업예정자) 전용 — 이미 재학 중인 대학생은 대상이 아니다.
// '진학 예정자'는 학년 진급("3학년 1학기 진학 예정자")에도 쓰여 여기 넣지 않는다.
const PRE_ENTRY_ONLY = /고등학교\s*졸업\s*예정|대학\s*진학이?\s*확정|대학\s*입학\s*예정/;
// 재학생도 대상에 포함된다는 신호 — 있으면 진학예정자 전용으로 보지 않는다
const ENROLLED_OK = /대학생|재학생|재학\s*중|휴학|복학/;

function checkGradeText(b: Benefit, u: UserProfile): { v: Verdict; msg: string } {
  if (u.grade === 0 || b.grades.length > 0) return { v: "pass", msg: "" };
  // 출처마다 대상 조건을 담는 섹션 이름이 다르고([자격]/[대상]), 섹션이 없으면 설명문에 들어 있다
  const jagyeok =
    sectionLine(b, "자격") ||
    sectionLine(b, "대상") ||
    (b.rawConditionText ? "" : (b.description ?? ""));
  if (!jagyeok || /제외|아닌|미만\s*제외/.test(jagyeok.slice(0, 4))) return { v: "pass", msg: "" };

  // "학년 제한 없음", "졸업예정자 제외"처럼 조건을 되레 넓히는 문구가 있으면 학년 판정을 하지 않는다
  if (NOT_FINAL_YEAR.test(jagyeok)) return { v: "pass", msg: "" };

  if (FINAL_YEAR_ONLY.test(jagyeok)) {
    return u.grade >= 4
      ? { v: "pass", msg: "" }
      : { v: "fail", msg: `최종 학년(졸업반) 대상 (내 학년: ${u.grade}학년)` };
  }
  if (GRADUATION_SOON.test(jagyeok) && u.grade < 4) {
    return { v: "unknown", msg: "졸업 예정자 대상 — 해당 시에만" };
  }
  if (PRE_ENTRY_ONLY.test(jagyeok) && !ENROLLED_OK.test(jagyeok)) {
    return { v: "fail", msg: "대학 진학 예정자(고교 졸업예정자) 대상 — 재학생은 해당 없음" };
  }

  for (const re of GRADE_RANGES) {
    const range = jagyeok.match(re);
    if (!range) continue;
    const [lo, hi] = [Number(range[1]), Number(range[2])].sort((a, c) => a - c);
    return u.grade >= lo && u.grade <= hi
      ? { v: "pass", msg: `학년 해당(${u.grade}학년)` }
      : { v: "fail", msg: `${lo}~${hi}학년 대상 (내 학년: ${u.grade}학년)` };
  }
  const min = jagyeok.match(GRADE_MIN);
  if (min) {
    return u.grade >= Number(min[1])
      ? { v: "pass", msg: `학년 해당(${u.grade}학년)` }
      : { v: "fail", msg: `${min[1]}학년 이상 대상 (내 학년: ${u.grade}학년)` };
  }
  // 나열형("2·3·4학년")과 단일 지정("1학년 또는 3학년")을 모두 모아 비교한다
  const enums = [...jagyeok.matchAll(GRADE_ENUM)].flatMap((m) =>
    [...m[1].matchAll(/\d/g)].map((d) => Number(d[0])),
  );
  const advancing = [...jagyeok.matchAll(GRADE_ADVANCING)].flatMap((m) => [
    Number(m[1]),
    Number(m[1]) - 1,
  ]);
  const exacts = [
    ...enums,
    ...advancing,
    ...GRADE_EXACT_PATTERNS.flatMap((re) => [...jagyeok.matchAll(re)].map((m) => Number(m[1]))),
  ].filter((n) => n >= 1);
  if (exacts.length > 0) {
    const set = [...new Set(exacts)].sort();
    return set.includes(u.grade)
      ? { v: "pass", msg: `학년 해당(${u.grade}학년)` }
      : { v: "fail", msg: `${set.join("·")}학년 대상 (내 학년: ${u.grade}학년)` };
  }
  return { v: "pass", msg: "" };
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
    checkGradeText(benefit, user),
    checkResidence(benefit, user),
    checkGpa(benefit, user),
    checkLastGpa(benefit, user),
    checkFlags(benefit, user),
    checkTargetGroups(benefit, user),
    checkUniversity(benefit, user),
    checkUnivLevel(benefit, user),
    checkUnivLocation(benefit, user),
    checkDepartment(benefit, user),
    checkFaculty(benefit, user),
    checkGender(benefit, user),
    checkRawEligibility(benefit, user),
    checkLifeStageGender(benefit, user),
    checkEvidence(benefit),
  ];

  // 빈 msg(판단 보류형 pass)는 결과 카드에 빈 체크칩으로 보이므로 걸러낸다
  const passed = checks.filter((c) => c.v === "pass" && c.msg).map((c) => c.msg);
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
