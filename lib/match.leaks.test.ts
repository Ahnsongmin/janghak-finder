import { describe, it, expect } from "vitest";
import { matchOne } from "./match";
import { getBenefits } from "./store";
import type { Benefit, UserProfile } from "./types";

// 2026-08-22 사용자 신고 오노출 회귀 테스트.
// 프로필: 서울 / 10분위 / 대학생(재학) 2학년 / 서강대(4년제) 기계공학과 / 남성.
// ID는 데이터 갱신 때 바뀌므로 이름·기관으로 찾는다(월간 재빌드에 견고).
const user: UserProfile = {
  region: "서울특별시",
  income: 10,
  eduStatus: "대학생(재학)",
  grade: 2,
  gpa: 4.3,
  gpaScale: 4.3,
  univ: "서강대학교",
  faculty: "",
  major: "기계공학과",
  gender: "남성",
  flags: [],
};

function findByName(nameKw: string, providerKw: string): Benefit | undefined {
  return getBenefits().find(
    (b) => b.name.includes(nameKw) && b.provider.includes(providerKw),
  );
}

describe("신고된 오노출 — 일반 학부생에게 제외돼야 하는 것들", () => {
  it("강신고무장학금(대학원 석·박사 전용)은 학부 재학생에게 제외", () => {
    const b = findByName("강신고무", "한국고무학회");
    expect(b, "데이터에 강신고무장학금 존재").toBeTruthy();
    expect(matchOne(b!, user).status).toBe("excluded");
  });

  it("몽은장학재단 우수장학생(학자금 조달 곤란 요건)은 10분위에게 제외", () => {
    const b = findByName("우수장학생", "몽은장학재단");
    expect(b, "데이터에 몽은 우수장학생 존재").toBeTruthy();
    const r = matchOne(b!, user);
    expect(r.status).toBe("excluded");
    expect(r.failed.some((m) => /가계곤란|저소득/.test(m))).toBe(true);
  });

  it("해석미술장학생(미술관련 학과 전용)은 기계공학과에게 제외", () => {
    const b = findByName("해석미술장학생", "해석정해영");
    expect(b, "데이터에 해석미술장학생 존재").toBeTruthy();
    const r = matchOne(b!, user);
    expect(r.status).toBe("excluded");
    expect(r.failed.some((m) => /예체능/.test(m))).toBe(true);
  });

  it("고속도로장학재단(사고 유자녀·유족 전용)은 일반 사용자에게 제외, 관련 플래그 보유자에겐 확인", () => {
    const items = getBenefits().filter((b) => b.provider.includes("고속도로장학재단"));
    expect(items.length).toBeGreaterThan(0);
    for (const b of items) {
      expect(matchOne(b, user).status, b.name).toBe("excluded");
      // 장애인(본인/가족) 플래그 보유자에겐 '조건확인'으로 남아야 함(누락 방지)
      const withFlag = { ...user, flags: ["장애인(본인/가족)"] };
      expect(matchOne(b, withFlag).status, `${b.name} (장애 플래그)`).not.toBe("excluded");
    }
  });

  it("지역공부방 장학금(광주전남 소재 대학)은 서강대(서울) 사용자에게 제외", () => {
    const b = findByName("지역공부방", "한국인터넷진흥원");
    expect(b, "데이터에 지역공부방 장학금 존재").toBeTruthy();
    const r = matchOne(b!, user);
    expect(r.status).toBe("excluded");
  });

  it("유희춘장학생('어려운 가정환경' 요건)은 10분위 제외, 5분위는 유지", () => {
    const b = findByName("유희춘", "천정");
    expect(b, "데이터에 유희춘장학생 존재").toBeTruthy();
    expect(matchOne(b!, user).status).toBe("excluded");
    expect(matchOne(b!, { ...user, income: 5 }).status).not.toBe("excluded");
  });

  it("'OO 소재 대학'이 내 대학 소재지와 일치하면 제외되지 않는다", () => {
    const base: Benefit = {
      id: "test:loc",
      name: "테스트 장학금",
      category: "장학금",
      provider: "테스트",
      sourceName: "테스트",
      regions: ["전국"],
      incomeMax: null,
      ageMin: null,
      ageMax: null,
      eduStatus: [],
      grades: [],
      requiredFlags: [],
      targetGroups: [],
      rawConditionText: "[자격] 서울 소재 대학교 재학생",
    };
    expect(matchOne(base, user).status).not.toBe("excluded");
    // 수도권 소재도 서울 대학이면 통과
    const sudo = { ...base, rawConditionText: "[자격] 수도권 소재 대학교 재학생" };
    expect(matchOne(sudo, user).status).not.toBe("excluded");
    // 시군 단위(시도 판별 불가)는 제외하지 않고 확인으로만
    const sgg = { ...base, rawConditionText: "[자격] 아산시 소재 대학교 재학생" };
    expect(matchOne(sgg, user).status).not.toBe("excluded");
  });

  it("대학원생 전용(eduStatus)이 재학 학부생에게 새지 않는다 — 전수 검사", () => {
    const gradOnly = getBenefits().filter(
      (b) => b.eduStatus.length > 0 && !b.eduStatus.includes("대학생(재학)") && b.eduStatus.includes("대학원생"),
    );
    expect(gradOnly.length).toBeGreaterThan(0);
    for (const b of gradOnly) {
      expect(matchOne(b, user).status, b.name).toBe("excluded");
    }
  });
});

describe("대학 수준(univLevels) 매칭", () => {
  const base: Benefit = {
    id: "test:lv",
    name: "테스트 장학금",
    category: "장학금",
    provider: "테스트",
    sourceName: "테스트",
    regions: ["전국"],
    incomeMax: null,
    ageMin: null,
    ageMax: null,
    eduStatus: [],
    grades: [],
    requiredFlags: [],
    targetGroups: [],
  };

  it("전문대 전용은 4년제(서강대) 사용자에게 제외", () => {
    expect(matchOne({ ...base, univLevels: ["전문대"] }, user).status).toBe("excluded");
  });

  it("4년제 포함이면 통과", () => {
    expect(matchOne({ ...base, univLevels: ["4년제", "전문대"] }, user).status).toBe("eligible");
  });

  it("대학 미선택 사용자에겐 수준으로 제외하지 않는다(누락 방지)", () => {
    expect(matchOne({ ...base, univLevels: ["전문대"] }, { ...user, univ: "" }).status).not.toBe(
      "excluded",
    );
  });
});

describe("2026-08-22 전수 감사에서 발견된 유형들", () => {
  const base: Benefit = {
    id: "test:audit",
    name: "테스트 장학금",
    category: "장학금",
    provider: "테스트",
    sourceName: "테스트",
    regions: ["전국"],
    incomeMax: null,
    ageMin: null,
    ageMax: null,
    eduStatus: [],
    grades: [],
    requiredFlags: [],
    targetGroups: [],
  };

  it("[자격] 외국인 대학(원)생 전용은 제외, '신청 가능' 확대 조항은 유지", () => {
    const b1 = { ...base, rawConditionText: "[자격] 현재 국내 대학에 재학 중인 외국인 대학(원)생" };
    expect(matchOne(b1, user).status).toBe("excluded");
    const b2 = { ...base, rawConditionText: "[자격] 외국인 유학생(언어소통가능자) 신청가능 재학생 대상" };
    expect(matchOne(b2, user).status).not.toBe("excluded");
  });

  it("[자격] 장애 학생 전용은 제외, '장애 학생은 성적기준 미적용' 예외 조항은 유지", () => {
    const b1 = { ...base, rawConditionText: "[자격] 이공계열 학과 재학 중인 장애인 대학(원)생 (전공무관)" };
    expect(matchOne(b1, user).status).toBe("excluded");
    const b2 = { ...base, rawConditionText: "[자격] 재학생 (장애 학생은 성적기준 미적용)" };
    expect(matchOne(b2, user).status).not.toBe("excluded");
  });

  it("[자격] 대학원 과정 전용은 학부생에게 제외, 학부 병행이면 유지", () => {
    const b1 = { ...base, rawConditionText: "[자격] 대학원 석사·박사과정 재학 중인 자" };
    expect(matchOne(b1, user).status).toBe("excluded");
    const b2 = { ...base, rawConditionText: "[자격] 학부생 및 대학원 석사과정 재학생" };
    expect(matchOne(b2, user).status).not.toBe("excluded");
  });

  it("이름이 여성 대상이면 남성 제외, 여성 사용자에겐 유지", () => {
    const b = { ...base, name: "여성청소년 생리용품 지원" };
    expect(matchOne(b, user).status).toBe("excluded");
    expect(matchOne(b, { ...user, gender: "여성" }).status).not.toBe("excluded");
  });

  it("이름이 저소득층 대상 사업이면 10분위 제외", () => {
    const b = { ...base, name: "저소득층 수도요금감면" };
    expect(matchOne(b, user).status).toBe("excluded");
  });

  it("[요약]이 특정 시도 주민 대상이면 타지역 거주자 제외 (경남도민 → 서울 사용자)", () => {
    const b = { ...base, rawConditionText: "[요약] 제도권 금융 이용이 어려운 취약 경남도민 대상으로 소액자금을 지원합니다." };
    expect(matchOne(b, user).status).toBe("excluded");
  });

  it("이름이 보훈·유공자 대상이면 플래그 미보유 시 제외", () => {
    const b = { ...base, name: "보훈원 양육지원" };
    expect(matchOne(b, user).status).toBe("excluded");
    expect(matchOne(b, { ...user, flags: ["국가보훈대상자"] }).status).not.toBe("excluded");
  });
});

describe("2026-08-22 저녁 신고분 — 공식 출처 확인 보정 포함", () => {
  it("김희경유럽정신문화재단 국내학부장학생(유럽인문학 전공)은 기계공학과에게 제외", () => {
    const b = findByName("국내학부장학생", "김희경");
    expect(b, "데이터에 김희경 국내학부장학생 존재").toBeTruthy();
    const r = matchOne(b!, user);
    expect(r.status).toBe("excluded");
    expect(r.failed.some((m) => /인문학/.test(m))).toBe(true);
    // 인문계열(철학과) 사용자에겐 제외되지 않아야 함
    expect(matchOne(b!, { ...user, major: "철학과" }).status).not.toBe("excluded");
  });

  it("케이씨미래장학금은 공식 공지 기준 소득 9분위 이하 — 10분위 제외, 9분위 유지", () => {
    const b = findByName("케이씨미래", "KC미래장학재단");
    expect(b, "데이터에 케이씨미래장학금 존재").toBeTruthy();
    expect(b!.incomeMax).toBe(9);
    expect(matchOne(b!, user).status).toBe("excluded");
    expect(matchOne(b!, { ...user, income: 9 }).status).not.toBe("excluded");
  });

  it("호반장학생 applyUrl은 폐쇄된 구 도메인이 아닌 공식 사이트여야 한다", () => {
    const b = findByName("호반장학생", "호반장학재단");
    expect(b, "데이터에 호반장학생 존재").toBeTruthy();
    expect(b!.applyUrl).toBe("https://www.hobansf.or.kr/");
  });

  it("매칭 결과의 passed 목록에 빈 문자열이 없다(빈 체크칩 방지)", () => {
    for (const b of getBenefits().slice(0, 500)) {
      const r = matchOne(b, user);
      expect(r.passed.every((m) => m.length > 0), b.name).toBe(true);
    }
  });
});

describe("[자격] 가계곤란 신호 — 우대는 제외 사유가 아님", () => {
  const base: Benefit = {
    id: "test:means",
    name: "테스트 장학금",
    category: "장학금",
    provider: "테스트",
    sourceName: "테스트",
    regions: ["전국"],
    incomeMax: null,
    ageMin: null,
    ageMax: null,
    eduStatus: [],
    grades: [],
    requiredFlags: [],
    targetGroups: [],
  };

  it("'기초생활수급자 우대'만 있으면 10분위도 제외하지 않는다", () => {
    const b = { ...base, rawConditionText: "[자격] 재학생 중 기초생활수급자 우대" };
    expect(matchOne(b, user).status).not.toBe("excluded");
  });

  it("'학자금 조달이 어려운 학생' 요건은 10분위 제외, 5분위는 유지", () => {
    const b = { ...base, rawConditionText: "[자격] 학교에 재학 중인 학자금 조달이 어려운 학생" };
    expect(matchOne(b, user).status).toBe("excluded");
    expect(matchOne(b, { ...user, income: 5 }).status).not.toBe("excluded");
  });

  it("'가정환경이 어렵지만'처럼 '어렵-'으로 끝나는 표기도 10분위 제외", () => {
    const b = { ...base, rawConditionText: "[자격] 가정환경이 어렵지만 학업 성적이 우수한 학생" };
    expect(matchOne(b, user).status).toBe("excluded");
  });
});

// 2026-08-22 심야 전수 감사에서 드러난 누수 유형별 회귀 테스트.
// 개별 장학금이 아니라 '유형'을 고정한다 — 데이터가 매달 바뀌어도 규칙이 살아 있는지 검증.
describe("전수 감사 — 누수 유형별 고정", () => {
  const base: Benefit = {
    id: "test:audit",
    name: "테스트 장학금",
    category: "장학금",
    provider: "테스트재단",
    sourceName: "테스트",
    regions: ["전국"],
    incomeMax: null,
    ageMin: null,
    ageMax: null,
    eduStatus: [],
    grades: [],
    requiredFlags: [],
    targetGroups: [],
  };
  const raw = (t: string): Benefit => ({ ...base, rawConditionText: t });

  it("학년 지정(1학년 재학생)은 2학년에게 제외, 1학년에겐 유지", () => {
    const b = raw("[자격] 현재 학부 1학년에 재학중인 학생");
    expect(matchOne(b, user).status).toBe("excluded");
    expect(matchOne(b, { ...user, grade: 1 }).status).not.toBe("excluded");
  });

  it("학년 범위(2~3학년)는 2학년에게 유지, 4학년에겐 제외", () => {
    const b = raw("[자격] 이공계대학의 2~3학년 재학생");
    expect(matchOne(b, user).status).not.toBe("excluded");
    expect(matchOne(b, { ...user, grade: 4 }).status).toBe("excluded");
  });

  it("연도 표기(2025~2026학년도)를 학년 범위로 오독하지 않는다", () => {
    const b = raw("[자격] 2025~2026학년도 정규 등록 학부 재학생");
    expect(matchOne(b, user).status).not.toBe("excluded");
  });

  it("나열된 학년(2·3·4학년)은 모두 대상으로 인정한다", () => {
    expect(matchOne(raw("[자격] 대학교 2·3·4학년 재학생"), user).status).not.toBe("excluded");
    expect(matchOne(raw("[자격] 대학교 2/3/4학년 재학생"), user).status).not.toBe("excluded");
    expect(matchOne(raw("[자격] 대학교 3·4학년 재학생"), user).status).toBe("excluded");
  });

  it("'3학년 진학 예정자'의 대상은 지금 2학년인 학생이다", () => {
    const b = raw("[자격] 2026학년도 1학기에 3학년 1학기 진학 예정자");
    expect(matchOne(b, user).status).not.toBe("excluded");
    expect(matchOne(b, { ...user, grade: 4 }).status).toBe("excluded");
  });

  it("'학년 제한 없음, 졸업예정자 제외'를 졸업반 전용으로 뒤집어 읽지 않는다", () => {
    const b = raw("[자격] 학년 제한 없음. 단 8월 졸업예정자 제외");
    expect(matchOne(b, user).status).not.toBe("excluded");
  });

  it("'대학생 또는 대학입학예정자'는 재학생도 대상이다", () => {
    expect(matchOne(raw("[자격] 대학생 또는 대학입학예정자"), user).status).not.toBe("excluded");
  });

  it("[자격]의 '해당 대학 제외' 목록을 전용 대상으로 뒤집어 읽지 않는다", () => {
    const b = raw("[자격] 대학 재학생. 한국방송통신대학교/사이버대학 제외");
    expect(matchOne(b, user).status).not.toBe("excluded");
  });

  it("'서울/경기 소재 대학'처럼 시도를 나열해도 서울 대학은 대상이다", () => {
    expect(matchOne(raw("[자격] 서울/경기 소재 대학교 재학생"), user).status).not.toBe("excluded");
  });

  it("'의과대학 소속이 아닌 재학생'을 의약계열 전용으로 읽지 않는다", () => {
    const b = raw("[자격] 2026년도 1학기 의과/약학대학 소속이 아닌 재학생");
    expect(matchOne(b, user).failed.some((m) => /의·한의·치·약학/.test(m))).toBe(false);
  });

  it("최종 학년(졸업반) 전용은 2학년에게 제외", () => {
    expect(matchOne(raw("[자격] 국내 4년제 대학의 최종 학년 재학생"), user).status).toBe("excluded");
  });

  it("고교 졸업예정자(대학 진학 예정) 전용은 재학생에게 제외", () => {
    const b = raw("[자격] 고등학교 졸업예정인 자 중 2026년 3월 대학 진학이 확정된 학생");
    expect(matchOne(b, user).status).toBe("excluded");
  });

  it("다른 대학 전용은 제외하되, 내 대학이 포함되면 유지", () => {
    expect(matchOne(raw("[자격] 서울대학교 재학생"), user).status).toBe("excluded");
    expect(matchOne(raw("[자격] 서강대학교 재학생"), user).status).not.toBe("excluded");
  });

  it("'국내 4년제 대학' 같은 일반 표현은 특정 대학으로 오인하지 않는다", () => {
    expect(matchOne(raw("[자격] 국내 4년제 대학 재학생"), user).status).not.toBe("excluded");
  });

  it("[지역거주]의 다른 시도 요건은 제외, 서울이면 유지", () => {
    const b = raw("[지역거주] 본인 또는 보호자가 전라북도에 3년 이상 주민등록을 두고 거주");
    expect(matchOne(b, user).status).toBe("excluded");
    expect(matchOne(b, { ...user, region: "전북특별자치도" }).status).not.toBe("excluded");
  });

  it("[지역거주]가 '관내'뿐이면 단정하지 않고 조건 확인으로 분류", () => {
    const b = raw("[지역거주] 공고일 현재 관내에 주소를 두고 1년 이상 거주한 자");
    expect(matchOne(b, user).status).toBe("review");
  });

  it("문중(성씨) 장학회는 조건 확인으로 분류", () => {
    expect(matchOne(raw("[자격] 풍양조씨인 자 성적이 우수한 대학 재학생"), user).status).toBe("review");
  });

  it("특정 전공자 전용은 조건 확인, 이공계 전체 대상은 유지", () => {
    expect(matchOne(raw("[자격] 지질/지구물리/자원공학 등 자원개발 유관 전공자"), user).status).toBe("review");
    expect(matchOne(raw("[자격] 이공계열 전공자 중 성적 우수자"), user).status).not.toBe("review");
  });

  it("[선발인원]에 학과를 못박으면 다른 학과에겐 조건 확인", () => {
    const b = raw("[자격] 2학년~4학년 재학중인 학생\n[선발인원] 화학과 2명 화학공학과 2명");
    expect(matchOne(b, user).status).toBe("review");
    expect(matchOne(b, { ...user, major: "화학공학과" }).status).not.toBe("review");
  });

  it("의·약학 대학 전용은 공학계열에게 제외, '포함' 확대 문구는 제외하지 않는다", () => {
    expect(matchOne(raw("[자격] 한의과대학 재학생"), user).status).toBe("excluded");
    const wide = raw("[자격] 대학(전문대 및 의학전문대학원 포함)에 재학중인 자");
    expect(matchOne(wide, user).status).not.toBe("excluded");
  });

  it("백분위(100점 만점) 성적 요건은 단정하지 않고 조건 확인", () => {
    const b = raw("[성적] 직전학기 성적이 평균 94점(100점 만점) 이상인 학생");
    expect(matchOne(b, user).status).toBe("review");
  });

  it("자격 근거가 요약뿐인 복지로 항목은 '받을 수 있음'으로 올리지 않는다", () => {
    const b: Benefit = {
      ...base,
      id: "bokjiro-central:WLF00000000",
      name: "연탄쿠폰",
      rawConditionText: "[요약] 난방비 부담경감을 위해 차액분을 쿠폰으로 지원합니다.",
    };
    expect(matchOne(b, user).status).not.toBe("eligible");
  });

  it("대학생과 무관한 대상의 복지서비스는 제외", () => {
    const b: Benefit = {
      ...base,
      id: "bokjiro-central:WLF00000001",
      name: "학교우유급식",
      rawConditionText: "[요약] 초·중·고 학생에게 우유를 공급합니다.",
    };
    expect(matchOne(b, user).status).toBe("excluded");
  });

  it("직전학기 요건은 '전학기 평점' 표기로도 인식한다", () => {
    const b = raw("[성적] 전학기 성적 평점 3.8/4.5 이상인 자");
    expect(matchOne(b, { ...user, lastGpa: 3.0 }).status).toBe("excluded");
    expect(matchOne(b, { ...user, lastGpa: 4.3 }).status).not.toBe("excluded");
  });
});
