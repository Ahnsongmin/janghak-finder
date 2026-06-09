import { describe, it, expect } from "vitest";
import { themeOf, relevanceScore } from "./theme";
import type { Benefit, MatchResult } from "./types";

function benefit(overrides: Partial<Benefit> = {}): Benefit {
  return {
    id: "t",
    name: "항목",
    category: "지원금",
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

function result(b: Benefit, overrides: Partial<MatchResult> = {}): MatchResult {
  return { benefit: b, status: "eligible", passed: [], unknown: [], failed: [], ...overrides };
}

describe("themeOf — 주제 분류", () => {
  it("category가 장학금이면 장학금", () => {
    expect(themeOf(benefit({ category: "장학금" }))).toBe("장학금");
  });
  it("이름에 '장학'이 있으면 장학금", () => {
    expect(themeOf(benefit({ name: "○○장학생" }))).toBe("장학금");
  });
  it("대학생/학자금 신호 → 청년·학생", () => {
    expect(themeOf(benefit({ name: "대학생 학자금 지원" }))).toBe("청년·학생");
  });
  // 주의: '청년·학생'을 주거/일자리보다 먼저 검사하므로, 이 브랜치 테스트엔 '청년'을 넣지 않는다.
  it("주거/임대 → 주거", () => {
    expect(themeOf(benefit({ name: "행복주택 월세 지원", description: "임대 보증금" }))).toBe("주거");
  });
  it("취업/창업 → 일자리·창업", () => {
    expect(themeOf(benefit({ name: "소상공인 창업 지원금" }))).toBe("일자리·창업");
  });
  it("의료/병원 → 의료·건강", () => {
    expect(themeOf(benefit({ name: "의료비 지원", description: "병원 진료" }))).toBe("의료·건강");
  });
  it("보육/돌봄 → 교육·보육", () => {
    expect(themeOf(benefit({ name: "아이돌봄 서비스", description: "어린이집 보육료" }))).toBe(
      "교육·보육",
    );
  });
  it("금융/대출 → 금융·생활", () => {
    expect(themeOf(benefit({ name: "생활안정 대출", description: "금융 지원" }))).toBe("금융·생활");
  });
  it("아무 신호 없으면 그 외", () => {
    expect(themeOf(benefit({ name: "○○ 안내", description: "일반 공지" }))).toBe("그 외");
  });
});

describe("relevanceScore — 우선순위 정렬 점수", () => {
  it("학과 전용 > 계열 전용 > 일반 장학금", () => {
    const dept = relevanceScore(result(benefit({ departments: ["전자공학"] })));
    const fac = relevanceScore(result(benefit({ faculties: ["공학계열"] })));
    const schol = relevanceScore(result(benefit({ category: "장학금" })));
    expect(dept).toBeGreaterThan(fac);
    expect(fac).toBeGreaterThan(schol);
  });
  it("같은 항목이면 eligible이 review보다 높다", () => {
    const b = benefit({ category: "장학금" });
    const elig = relevanceScore(result(b, { status: "eligible" }));
    const rev = relevanceScore(result(b, { status: "review" }));
    expect(elig).toBeGreaterThan(rev);
  });
  it("충족 조건이 많을수록(passed) 높고, 미상(unknown)은 감점", () => {
    const b = benefit();
    const many = relevanceScore(result(b, { passed: ["a", "b", "c"], unknown: [] }));
    const few = relevanceScore(result(b, { passed: ["a"], unknown: ["x"] }));
    expect(many).toBeGreaterThan(few);
  });
});
