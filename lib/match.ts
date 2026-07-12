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
  // 약칭↔정식 정규화: "이화여대"↔"이화여자대학교", "서강대학교"↔"서강대학" 등. 긴 어미부터 제거.
  const norm = (s: string) => s.replace(/여자대학교|여자대학|여대|대학교|대학|\s|\(.*?\)/g, "");
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
const MED_RESEARCH = /(?:의\/?약학|의학|약학|치의학|한의학|수의학)\s*(?:연구자|연구|학술|학회)|학술\s*부문\s*(?:각?\s*\d+\s*편|논문)/;

// 특정 직군 '재직자/연금적용' 전용. 자녀·가족 동반 여부로 fail↔review 분기.
const EMPLOYEE_ONLY =
  /사립학교교직원연금|공무원연금[^\n]{0,6}적용|군인연금[^\n]{0,6}적용|재직\s*(?:중인\s*)?(?:교직원|교원|임직원|직원|근로자|교사|공무원)|(?:현직|재직)\s*(?:교사|교수|공무원|군인|경찰|소방관?)/;
const EMPLOYEE_FAMILY = /자녀|자제|가족|배우자|직계/;

// 자치구(구/군) 단위 거주 전용 — 시도만 입력한 사용자는 확인 불가(시도는 checkRegion이 처리).
const SGG_RESIDENCE = /([가-힣]{2,4}[구군])\s*(?:에\s*)?(?:거주|주민등록|관내)/;

function rawText(b: Benefit): string {
  return `${b.name} ${b.rawConditionText ?? ""} ${b.description ?? ""}`;
}

function checkRawEligibility(b: Benefit, u: UserProfile): { v: Verdict; msg: string } {
  const text = rawText(b);

  // 1) 고/중학생·직업계고·위탁과정 전용 — 대학(원)생은 제외
  if (isUniversityStudent(u) && SCHOOL_LEVEL_ONLY.test(text) && !SCHOOL_LEVEL_OK.test(text)) {
    return { v: "fail", msg: "고교·중학생(직업계고/위탁과정 등) 대상 — 대학생은 해당 없음" };
  }

  // 2) 의·약학 연구자/학술 논문 지원 — 계열을 알고 의약·보건이 아니면 제외, 모르면 확인
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

  // 4) 자치구(구/군) 거주 전용 — 시도만 입력한 사용자는 확인 필요(누락 방지로 제외하지 않음)
  const m = text.match(SGG_RESIDENCE);
  if (m) {
    return { v: "unknown", msg: `${m[1]} 거주자 대상 — 해당 자치구 거주 시에만` };
  }

  return { v: "pass", msg: "추가 자격조건 없음" };
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
  const name = b.name;
  const text = rawText(b);

  // 1) 임신·출산·산모(신체조건) — 남성 제외. 난임/영유아는 부모 가능성으로 제외 안 함.
  if (/임신|출산|산모|임산부|모성/.test(name) && !/난임|영유아|영아|기저귀|분유/.test(name)) {
    if (u.gender === "남성") return { v: "fail", msg: "임신·출산 지원 — 남성은 해당 없음" };
    return { v: "pass", msg: "" };
  }
  // 2) 여성 전용/여성 위기지원 — 남성 제외
  if (/여성긴급|위기여성|미혼모|여성\s*전용|성매매[^\n]{0,6}피해|여성[^\n]{0,4}쉼터/.test(text) && u.gender === "남성") {
    return { v: "fail", msg: "여성 대상 지원 — 남성은 해당 없음" };
  }

  // 3) 플래그 매핑 집단 — 해당 플래그 미보유 시 제외 (이름 기반 강한 신호 + 학과 가드)
  const has = (f: string) => u.flags.includes(f);
  if (/외국인|국내체류외국인|이주민|결혼이민|이주노동/.test(name) && !has("다문화가족")) {
    return { v: "fail", msg: "외국인·이주민 대상 — 해당 없음" };
  }
  if (/북한이탈주민|새터민/.test(name) && !has("북한이탈주민")) {
    return { v: "fail", msg: "북한이탈주민 대상 — 해당 없음(특수자격 미선택)" };
  }
  if (/다문화/.test(name) && !has("다문화가족") && !ACADEMIC_GUARD.test(name)) {
    return { v: "fail", msg: "다문화가족 대상 — 해당 없음(특수자격 미선택)" };
  }
  if (/장애인|장애아|장애\s*대학생|중증장애|발달장애/.test(name) && !has("장애인(본인/가족)") && !ACADEMIC_GUARD.test(name)) {
    return { v: "fail", msg: "장애인 대상 — 해당 없음(특수자격 미선택)" };
  }
  if (/한부모|미혼모|조손\s*가정|모자가정|부자가정/.test(name) && !has("한부모가족")) {
    return { v: "fail", msg: "한부모·조손가정 대상 — 해당 없음(특수자격 미선택)" };
  }

  // 4) 노인·고령 — 젊은 사용자면 제외 (학과/요양보호사 양성 등은 가드로 제외)
  if (/노인|어르신|고령자?|경로(?:당|우대)|65세\s*이상|장기요양|치매/.test(name) && youngUser(u) && !ACADEMIC_GUARD.test(name)) {
    return { v: "fail", msg: "노인·고령자 대상 — 대학생은 해당 없음" };
  }

  // 5) 영유아·아동(수령 대상이 아동) — 학생-부모 가능성으로 조건확인
  if (/영유아|영아|어린이집|보육료|아동수당|기저귀|분유/.test(name) && !ACADEMIC_GUARD.test(name)) {
    return { v: "unknown", msg: "영유아·아동 양육 가구 대상 — 해당 시에만" };
  }

  return { v: "pass", msg: "생애주기·성별 조건 없음" };
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
    checkRawEligibility(benefit, user),
    checkLifeStageGender(benefit, user),
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
