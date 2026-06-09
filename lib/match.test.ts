import { describe, it, expect } from "vitest";
import { matchOne, matchAll } from "./match";
import type { Benefit, UserProfile } from "./types";

// 매칭 엔진의 계약을 고정한다. 하드제약 시리즈(보훈·군자녀·이주배경 등)가
// 정규식 한 줄 변경으로 조용히 깨지는 것을 막는 회귀 방지망.
// 검증은 공개 API(matchOne)의 관찰 가능한 결과(status)로만 한다 — 내부 check함수는 보지 않는다.

// 모든 조건이 '무관/전국'인 기준 장학금 → 기준 사용자는 eligible.
function benefit(overrides: Partial<Benefit> = {}): Benefit {
  return {
    id: "t",
    name: "테스트장학금",
    category: "장학금",
    provider: "기관",
    sourceName: "출처",
    regions: ["전국"],
    incomeMax: null,
    ageMin: null,
    ageMax: null,
    eduStatus: [],
    grades: [],
    requiredFlags: [],
    targetGroups: [],
    ...overrides,
  };
}

// 아무것도 입력하지 않은 기준 사용자.
function user(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    region: "",
    income: 0,
    eduStatus: "",
    grade: 0,
    univ: "",
    faculty: "",
    gender: "",
    major: "",
    flags: [],
    ...overrides,
  };
}

const statusOf = (b: Benefit, u: UserProfile) => matchOne(b, u).status;

describe("기준선", () => {
  it("모든 조건 무관 + 기준 사용자 → eligible", () => {
    expect(statusOf(benefit(), user())).toBe("eligible");
  });
});

describe("targetGroups (OR · 이주배경/보훈 등 전용 대상)", () => {
  it("다문화 전용 + 플래그 없는 일반 사용자 → excluded", () => {
    expect(statusOf(benefit({ targetGroups: ["다문화가족"] }), user())).toBe("excluded");
  });
  it("다문화 전용 + 다문화가족 플래그 → eligible", () => {
    expect(statusOf(benefit({ targetGroups: ["다문화가족"] }), user({ flags: ["다문화가족"] }))).toBe(
      "eligible",
    );
  });
  it("북한이탈 전용 + 북한이탈주민 플래그 → eligible, 일반 → excluded", () => {
    const b = benefit({ targetGroups: ["북한이탈주민"] });
    expect(statusOf(b, user({ flags: ["북한이탈주민"] }))).toBe("eligible");
    expect(statusOf(b, user())).toBe("excluded");
  });
  it("multi-OR(저소득 또는 다문화) + 저소득 플래그만 있어도 노출 → eligible (누락 방지)", () => {
    const b = benefit({ targetGroups: ["기초생활수급자", "차상위계층", "한부모가족", "다문화가족"] });
    expect(statusOf(b, user({ flags: ["기초생활수급자"] }))).toBe("eligible");
    expect(statusOf(b, user({ flags: ["한부모가족"] }))).toBe("eligible");
    expect(statusOf(b, user())).toBe("excluded");
  });
});

describe("requiredFlags (AND · 모두 충족해야 함)", () => {
  it("군자녀 전용 + 플래그 없음 → excluded, 있음 → eligible", () => {
    const b = benefit({ requiredFlags: ["군인 자녀(군자녀)"] });
    expect(statusOf(b, user())).toBe("excluded");
    expect(statusOf(b, user({ flags: ["군인 자녀(군자녀)"] }))).toBe("eligible");
  });
  it("두 플래그 요구 + 하나만 보유 → excluded (AND)", () => {
    const b = benefit({ requiredFlags: ["A", "B"] });
    expect(statusOf(b, user({ flags: ["A"] }))).toBe("excluded");
    expect(statusOf(b, user({ flags: ["A", "B"] }))).toBe("eligible");
  });
});

describe("소득(income)", () => {
  it("incomeMax 명시: 이하 → eligible, 초과 → excluded, 미입력(0) → review", () => {
    const b = benefit({ incomeMax: 5 });
    expect(statusOf(b, user({ income: 3 }))).toBe("eligible");
    expect(statusOf(b, user({ income: 7 }))).toBe("excluded");
    expect(statusOf(b, user({ income: 0 }))).toBe("review");
  });
  it("incomeNote에서 구간 추론: '8구간 이하' + 9분위 → excluded", () => {
    const b = benefit({ incomeNote: "소득 8구간 이하 대상" });
    expect(statusOf(b, user({ income: 9 }))).toBe("excluded");
    expect(statusOf(b, user({ income: 3 }))).toBe("review"); // 추론구간 이하지만 정밀확인 필요
  });
  it("저소득·복지 연계 신호 + 상위소득(8분위) → excluded, 하위(0/6) → review", () => {
    const b = benefit({ incomeNote: "가계곤란 저소득 가정" });
    expect(statusOf(b, user({ income: 8 }))).toBe("excluded");
    expect(statusOf(b, user({ income: 6 }))).toBe("review");
    expect(statusOf(b, user({ income: 0 }))).toBe("review");
  });
  it("이름이 복지급여(생계급여)면 incomeNote 없어도 상위소득 → excluded", () => {
    const b = benefit({ name: "생계급여 지원", incomeMax: null });
    expect(statusOf(b, user({ income: 8 }))).toBe("excluded");
  });
  it("중위소득 100% 환산(=5구간) + 7분위 → excluded", () => {
    const b = benefit({ incomeNote: "기준중위소득 100% 이하" });
    expect(statusOf(b, user({ income: 7 }))).toBe("excluded");
    expect(statusOf(b, user({ income: 4 }))).toBe("review");
  });
});

describe("평점(gpa) — 만점 기준 비율 환산", () => {
  it("요구 4.0/4.5, 사용자 4.0/4.5 → eligible, 3.0/4.5 → excluded", () => {
    const b = benefit({ gpaMin: 4.0, gpaScale: 4.5 });
    expect(statusOf(b, user({ gpa: 4.0, gpaScale: 4.5 }))).toBe("eligible");
    expect(statusOf(b, user({ gpa: 3.0, gpaScale: 4.5 }))).toBe("excluded");
  });
  it("만점이 달라도 비율로 비교: 요구 3.8/4.3 ↔ 사용자 4.0/4.5 → eligible", () => {
    const b = benefit({ gpaMin: 3.8, gpaScale: 4.3 });
    expect(statusOf(b, user({ gpa: 4.0, gpaScale: 4.5 }))).toBe("eligible");
  });
  it("평점 미입력 → review", () => {
    expect(statusOf(benefit({ gpaMin: 4.0, gpaScale: 4.5 }), user())).toBe("review");
  });
});

describe("거주지역(region)", () => {
  it("특정 시도 + 일치 → eligible, 불일치 → excluded, 미입력 → review", () => {
    const b = benefit({ regions: ["서울특별시"] });
    expect(statusOf(b, user({ region: "서울특별시" }))).toBe("eligible");
    expect(statusOf(b, user({ region: "부산광역시" }))).toBe("excluded");
    expect(statusOf(b, user())).toBe("review");
  });
  it("지역 미상(빈 배열) → review", () => {
    expect(statusOf(benefit({ regions: [] }), user())).toBe("review");
  });
});

describe("연령/재학상태/학년", () => {
  it("연령범위: 충족 → eligible, 초과 → excluded, 미입력 → review", () => {
    const b = benefit({ ageMin: 19, ageMax: 29 });
    expect(statusOf(b, user({ age: 25 }))).toBe("eligible");
    expect(statusOf(b, user({ age: 35 }))).toBe("excluded");
    expect(statusOf(b, user())).toBe("review");
  });
  it("재학상태: 일치 → eligible, 불일치 → excluded", () => {
    const b = benefit({ eduStatus: ["대학원생"] });
    expect(statusOf(b, user({ eduStatus: "대학원생" }))).toBe("eligible");
    expect(statusOf(b, user({ eduStatus: "대학생(재학)" }))).toBe("excluded");
  });
  it("학년: 일치 → eligible, 불일치 → excluded, 미입력 → review", () => {
    const b = benefit({ grades: [3, 4] });
    expect(statusOf(b, user({ grade: 3 }))).toBe("eligible");
    expect(statusOf(b, user({ grade: 1 }))).toBe("excluded");
    expect(statusOf(b, user())).toBe("review");
  });
});

describe("대학(university) — 약칭/여대 퍼지 매칭", () => {
  it("이화여자대학교 ↔ 이화여대 정규화 → eligible", () => {
    expect(statusOf(benefit({ university: "이화여자대학교" }), user({ univ: "이화여대" }))).toBe(
      "eligible",
    );
  });
  it("서강대학교 ↔ 서강대 → eligible, 대학 미선택 → excluded", () => {
    const b = benefit({ university: "서강대학교" });
    expect(statusOf(b, user({ univ: "서강대" }))).toBe("eligible");
    expect(statusOf(b, user())).toBe("excluded");
  });
  it("다른 대학 → excluded", () => {
    expect(statusOf(benefit({ university: "이화여자대학교" }), user({ univ: "서강대" }))).toBe(
      "excluded",
    );
  });
});

describe("학과/계열(department/faculty)", () => {
  it("학과 전용: 일치(퍼지) → eligible, 미입력/불일치 → excluded", () => {
    const b = benefit({ departments: ["전자공학"] });
    expect(statusOf(b, user({ major: "전자공학과" }))).toBe("eligible");
    expect(statusOf(b, user())).toBe("excluded");
    expect(statusOf(b, user({ major: "국어국문학과" }))).toBe("excluded");
  });
  it("계열 전용(공학): 학과에서 계열 추론 → eligible, 타계열 → excluded", () => {
    const b = benefit({ faculties: ["공학계열"] });
    expect(statusOf(b, user({ major: "전자공학과" }))).toBe("eligible");
    expect(statusOf(b, user({ faculty: "인문계열" }))).toBe("excluded");
  });
});

describe("성별(genderOnly)", () => {
  it("여성 전용: 여성 → eligible, 남성 → excluded, 미입력 → review", () => {
    const b = benefit({ genderOnly: "여성" });
    expect(statusOf(b, user({ gender: "여성" }))).toBe("eligible");
    expect(statusOf(b, user({ gender: "남성" }))).toBe("excluded");
    expect(statusOf(b, user())).toBe("review");
  });
});

describe("3-state 종합 판정", () => {
  it("fail이 하나라도 있으면 unknown이 있어도 excluded (fail 우선)", () => {
    // 지역 불일치(fail) + 연령 미입력(unknown)
    const b = benefit({ regions: ["서울특별시"], ageMin: 19, ageMax: 29 });
    const r = matchOne(b, user({ region: "부산광역시" }));
    expect(r.status).toBe("excluded");
    expect(r.failed.length).toBeGreaterThan(0);
  });
  it("fail 없고 unknown 있으면 review", () => {
    const b = benefit({ ageMin: 19, ageMax: 29 }); // 연령 미입력 → unknown
    const r = matchOne(b, user());
    expect(r.status).toBe("review");
    expect(r.unknown.length).toBeGreaterThan(0);
  });
});

describe("matchAll 집계", () => {
  it("eligible/review/excluded를 정확히 분류·집계한다", () => {
    const benefits = [
      benefit({ id: "ok" }), // eligible
      benefit({ id: "rev", ageMin: 19, ageMax: 29 }), // review (연령 미입력)
      benefit({ id: "ex", regions: ["서울특별시"] }), // excluded (부산 사용자)
    ];
    const res = matchAll(benefits, user({ region: "부산광역시" }));
    expect(res.eligible.map((r) => r.benefit.id)).toEqual(["ok"]);
    expect(res.review.map((r) => r.benefit.id)).toEqual(["rev"]);
    expect(res.excludedCount).toBe(1);
  });
});
