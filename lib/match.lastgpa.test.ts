import { describe, it, expect } from "vitest";
import { matchOne } from "./match";
import type { Benefit, UserProfile } from "./types";

// 직전학기 성적 요건 매칭 — 실데이터(KOSAF [성적] 원문) 문형을 그대로 검증한다.

function benefit(rawConditionText: string): Benefit {
  return {
    id: "test:lastgpa",
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
    rawConditionText,
  };
}

function user(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    region: "서울특별시",
    income: 0,
    eduStatus: "",
    grade: 0,
    univ: "",
    faculty: "",
    major: "",
    gender: "",
    flags: [],
    ...overrides,
  };
}

describe("직전학기 성적 요건", () => {
  const b = benefit("[성적] 직전학기 12학점 이상 취득하고 성적 평균 2.75 이상인 자 (4.3만점은 2.6이상)");

  it("직전학기 평점 충족이면 eligible", () => {
    expect(matchOne(b, user({ lastGpa: 3.0, gpaScale: 4.5 })).status).toBe("eligible");
  });

  it("직전학기 평점 미달이면 excluded", () => {
    const r = matchOne(b, user({ lastGpa: 2.5, gpaScale: 4.5 }));
    expect(r.status).toBe("excluded");
    expect(r.failed.some((m) => /직전학기 평점 미달/.test(m))).toBe(true);
  });

  it("4.3 만점 사용자는 4.3 기준 요건(2.6)으로 비교한다", () => {
    expect(matchOne(b, user({ lastGpa: 2.6, gpaScale: 4.3 })).status).toBe("eligible");
    expect(matchOne(b, user({ lastGpa: 2.5, gpaScale: 4.3 })).status).toBe("excluded");
  });

  it("직전학기 성적 미입력이면 review + 입력 안내", () => {
    const r = matchOne(b, user());
    expect(r.status).toBe("review");
    expect(r.unknown.some((m) => /직전학기 성적 입력 시 확인/.test(m))).toBe(true);
  });

  it("전체 평점만 입력해도 직전학기 요건은 확인 필요로 남는다(대신 쓰지 않음)", () => {
    const r = matchOne(b, user({ gpa: 4.3, gpaScale: 4.5 }));
    expect(r.status).toBe("review");
  });

  it("'(3.5/4.5만점)' 쌍 표기를 기준/만점으로 읽는다", () => {
    const b2 = benefit("[성적] 직전학기 성적이 (3.5/4.5만점)이상이고 직전학기 이수학점이 12학점 이상");
    expect(matchOne(b2, user({ lastGpa: 3.6, gpaScale: 4.5 })).status).toBe("eligible");
    expect(matchOne(b2, user({ lastGpa: 3.4, gpaScale: 4.5 })).status).toBe("excluded");
  });

  it("이수학점 수치(14학점)를 평점으로 오인하지 않는다", () => {
    const b3 = benefit("[성적] 직전학기 이수학점 14학점 이상 및 평점 2.0이상");
    expect(matchOne(b3, user({ lastGpa: 2.1, gpaScale: 4.5 })).status).toBe("eligible");
    expect(matchOne(b3, user({ lastGpa: 1.9, gpaScale: 4.5 })).status).toBe("excluded");
  });

  it("문자 등급(B+)은 환산하지 않고 review + 원문 안내", () => {
    const b4 = benefit("[성적] 직전학기 평균성적이 B+ 이상인 자");
    const r = matchOne(b4, user({ lastGpa: 4.4, gpaScale: 4.5 }));
    expect(r.status).toBe("review");
    expect(r.unknown.some((m) => /직전학기 성적 조건/.test(m))).toBe(true);
  });

  it("'직전 학기까지 누계 평점'은 전체 평점 조건 — 직전학기 게이팅 안 함", () => {
    const b5 = benefit("[성적] 직전 학기까지 누계 평균평점 3.5이상 (4.5만점 기준)인 사람");
    expect(matchOne(b5, user({ lastGpa: 1.0, gpaScale: 4.5 })).status).toBe("eligible");
  });

  it("직전학기 언급이 없는 항목은 영향 없음", () => {
    const b6 = benefit("[성적] 전체 평점평균 3.0 이상");
    expect(matchOne(b6, user({ lastGpa: 1.0, gpaScale: 4.5 })).status).toBe("eligible");
  });
});
