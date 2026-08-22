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
});
