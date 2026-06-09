import { describe, it, expect } from "vitest";
import { facultyOf, resolveFaculty } from "./faculty";

// 학과명 → 계열 추론. 핵심 함정: 더 구체적인 계열(공학·의약)을 일반 계열(자연)보다
// 먼저 검사하므로 "화학공학"은 공학, "화학"은 자연으로 갈려야 한다.

describe("facultyOf — 학과명에서 계열 추론", () => {
  it("전자공학과 → 공학계열", () => {
    expect(facultyOf("전자공학과")).toBe("공학계열");
  });
  it("화학공학과 → 공학계열 (자연으로 새지 않음)", () => {
    expect(facultyOf("화학공학과")).toBe("공학계열");
  });
  it("화학과 → 자연계열", () => {
    expect(facultyOf("화학과")).toBe("자연계열");
  });
  // norm() 접미사 처리 회귀 가드: '학과'를 통째로 지우면 '학'이 잘려 오분류·null이 됐었다.
  it("수학과 → 자연계열 ('학' 잘림 방지)", () => {
    expect(facultyOf("수학과")).toBe("자연계열");
  });
  it("생명과학과 → 자연계열", () => {
    expect(facultyOf("생명과학과")).toBe("자연계열");
  });
  it("공학부 → 공학계열 ('학부' 통째 제거 방지)", () => {
    expect(facultyOf("공학부")).toBe("공학계열");
  });
  it("간호학과 → 의약·보건계열", () => {
    expect(facultyOf("간호학과")).toBe("의약·보건계열");
  });
  it("경영학과 → 상경계열", () => {
    expect(facultyOf("경영학과")).toBe("상경계열");
  });
  it("국어국문학과 → 인문계열", () => {
    expect(facultyOf("국어국문학과")).toBe("인문계열");
  });
  it("사회복지학과 → 사회계열", () => {
    expect(facultyOf("사회복지학과")).toBe("사회계열");
  });
  it("유아교육과 → 교육계열", () => {
    expect(facultyOf("유아교육과")).toBe("교육계열");
  });
  it("빈 입력 → null", () => {
    expect(facultyOf("")).toBeNull();
  });
  it("매칭되는 키워드 없으면 null", () => {
    expect(facultyOf("가나다학과")).toBeNull();
  });
});

describe("resolveFaculty — 선택 계열 우선, 없으면 학과에서 추론", () => {
  it("유효한 선택 계열이 있으면 그대로 사용", () => {
    expect(resolveFaculty("공학계열", "")).toBe("공학계열");
  });
  it("선택 계열 없으면 학과에서 추론", () => {
    expect(resolveFaculty("", "전자공학과")).toBe("공학계열");
  });
  it("선택값이 유효 계열이 아니면 학과 추론으로 폴백", () => {
    expect(resolveFaculty("아무계열", "전자공학과")).toBe("공학계열");
  });
  it("둘 다 없으면 null", () => {
    expect(resolveFaculty("", "")).toBeNull();
  });
});
