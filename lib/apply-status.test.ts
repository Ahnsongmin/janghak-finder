import { describe, it, expect } from "vitest";
import { applyStatus, fmtMD, daysLeft } from "./apply-status";
import type { Benefit } from "./types";

// 모집기간 상태 판정. now를 주입해 결정론적으로 검증한다(시스템 시계 비의존).
const NOW = new Date(2026, 5, 10); // 2026-06-10

function withPeriod(applyPeriod?: string): Benefit {
  return {
    id: "t",
    name: "n",
    category: "장학금",
    provider: "p",
    sourceName: "s",
    regions: ["전국"],
    incomeMax: null,
    ageMin: null,
    ageMax: null,
    eduStatus: [],
    grades: [],
    requiredFlags: [],
    targetGroups: [],
    ...(applyPeriod !== undefined ? { applyPeriod } : {}),
  };
}

const stateOf = (p?: string) => applyStatus(withPeriod(p), NOW).state;

describe("applyStatus 상태 판정", () => {
  it("모집 중 → open", () => {
    expect(stateOf("20260601 ~ 20260630")).toBe("open");
  });
  it("시작 전 → upcoming", () => {
    expect(stateOf("20260701 ~ 20260731")).toBe("upcoming");
  });
  it("마감 → closed", () => {
    expect(stateOf("20260101 ~ 20260131")).toBe("closed");
  });
  it("applyPeriod 없음 → always", () => {
    expect(stateOf(undefined)).toBe("always");
  });
  it("빈 문자열 → always", () => {
    expect(stateOf("")).toBe("always");
  });
  it("형식 불명(8자리 아님) → always", () => {
    expect(stateOf("상시모집 ~ 별도공지")).toBe("always");
  });
  it("종료일만 있고 아직 안 지남 → open", () => {
    expect(stateOf(" ~ 20260630")).toBe("open");
  });
  it("시작일만 있고 이미 시작됨 → open", () => {
    expect(stateOf("20260601 ~ ")).toBe("open");
  });
  it("경계: 종료일이 오늘이면 마지막 날도 open", () => {
    expect(stateOf("20260601 ~ 20260610")).toBe("open");
  });
  it("경계: 시작일이 오늘이면 open", () => {
    expect(stateOf("20260610 ~ 20260620")).toBe("open");
  });
  it("잘못된 월/일(13월·32일)은 무효 처리 → always", () => {
    expect(stateOf("20261301 ~ 20260632")).toBe("always");
  });
});

describe("applyStatus start/end 보존", () => {
  it("파싱된 Date를 그대로 돌려준다", () => {
    const info = applyStatus(withPeriod("20260601 ~ 20260630"), NOW);
    expect(info.start).toEqual(new Date(2026, 5, 1));
    expect(info.end).toEqual(new Date(2026, 5, 30));
  });
});

describe("daysLeft", () => {
  it("종료일까지 남은 일수", () => {
    expect(daysLeft(new Date(2026, 5, 20), NOW)).toBe(10);
  });
  it("이미 지난 경우 음수", () => {
    expect(daysLeft(new Date(2026, 5, 1), NOW)).toBe(-9);
  });
  it("당일이면 0", () => {
    expect(daysLeft(new Date(2026, 5, 10), NOW)).toBe(0);
  });
  it("end 없으면 null", () => {
    expect(daysLeft(null, NOW)).toBeNull();
  });
});

describe("fmtMD", () => {
  it("M/D 형식", () => {
    expect(fmtMD(new Date(2026, 5, 24))).toBe("6/24");
  });
  it("null이면 빈 문자열", () => {
    expect(fmtMD(null)).toBe("");
  });
});
