import { describe, it, expect } from "vitest";
import { matchOne } from "./match";
import { getBenefitById, getBenefits } from "./store";
import type { UserProfile } from "./types";

// 버그 재현: 서울/서강대 기계공학과 2학년/4.3만점/10분위/남성(특수자격 없음)에게
// 해당 안 되는 항목들이 eligible/review로 새는 문제.
const user: UserProfile = {
  region: "서울특별시",
  income: 10,
  eduStatus: "",
  grade: 2,
  gpa: 4.3,
  gpaScale: 4.3,
  univ: "서강대학교",
  faculty: "",
  major: "기계공학과",
  gender: "남성",
  flags: [],
};

// 명백히 불가능 → 제외(excluded).
const SHOULD_EXCLUDE = [
  "youthcenter:20260311005400112111", // 직업계고/위탁과정 고3 전용 — 대학생은 불가
  "kosaf-schol:187:재단법인 한독제", // 의/약학 연구자 학술 — 공학 학부생 불가
];

// 가능성은 있으나 특수신분 필요 → 조건확인(review)으로 분리 + 정확한 사유 노출.
const SHOULD_REVIEW_WITH_NOTE: { id: string; note: RegExp }[] = [
  { id: "kosaf-schol:1118:사립학교교직원연", note: /교직원|연금/ }, // 본인·자녀 전용
  { id: "youthcenter:20260415005400212749", note: /중랑구|거주/ }, // 자치구 거주
];

describe("원문 기반 자격 필터 — 일반 학부생 오노출 방지", () => {
  for (const id of SHOULD_EXCLUDE) {
    it(`${id} 는 제외(excluded)되어야 한다`, () => {
      const b = getBenefitById(id);
      expect(b, `데이터에 ${id} 가 있어야 함`).toBeTruthy();
      expect(matchOne(b!, user).status).toBe("excluded");
    });
  }

  for (const { id, note } of SHOULD_REVIEW_WITH_NOTE) {
    it(`${id} 는 조건확인(review) + 정확한 사유를 보여야 한다`, () => {
      const b = getBenefitById(id);
      expect(b, `데이터에 ${id} 가 있어야 함`).toBeTruthy();
      const r = matchOne(b!, user);
      expect(r.status).toBe("review");
      expect(r.unknown.some((m) => note.test(m)), `사유에 ${note} 포함`).toBe(true);
    });
  }

  // ── 성별·생애주기 게이팅 ──
  it("임신·출산 지원은 남성에게 제외돼야 한다", () => {
    const items = getBenefits().filter((x) => /임신|출산|산모/.test(x.name) && !/난임|영유아/.test(x.name));
    expect(items.length, "임신·출산 이름 항목 존재").toBeGreaterThan(0);
    for (const it of items.slice(0, 5)) {
      expect(matchOne(it, user).status, `${it.name} 남성 제외`).toBe("excluded");
    }
  });
  it("외국인·북한이탈·장애 전용(플래그 미보유)은 제외돼야 한다", () => {
    const items = getBenefits().filter((x) => /^외국인|국내체류외국인|북한이탈주민\s*장학|장애대학생/.test(x.name));
    expect(items.length).toBeGreaterThan(0);
    for (const it of items.slice(0, 6)) {
      expect(matchOne(it, user).status, `${it.name} 제외`).toBe("excluded");
    }
  });
  it("노인·고령 대상은 대학생에게 제외돼야 한다", () => {
    const items = getBenefits().filter((x) => /노인맞춤|어르신|장기요양|경로/.test(x.name));
    expect(items.length).toBeGreaterThan(0);
    for (const it of items.slice(0, 5)) {
      expect(matchOne(it, user).status, `${it.name} 제외`).toBe("excluded");
    }
  });

  // 회귀 방지: 진짜 대상/후보 장학금은 그대로 유지돼야 함(오제외 = 누락 금지).
  it("국가장학금 Ⅰ유형은 9구간 초과(10분위)라 제외", () => {
    expect(matchOne(getBenefitById("nat:kosaf:type1")!, user).status).toBe("excluded");
  });
  it("관정 이종환 학부장학금(소득무관·평점 3.8/4.3)은 제외되면 안 됨", () => {
    const r = matchOne(getBenefitById("fnd:ikef:undergrad")!, user);
    expect(r.status).not.toBe("excluded"); // 4.3/4.3 ≥ 3.8/4.3, 소득무관
  });

  // 게이팅은 자기신고 기반 — 해당 플래그를 체크한 사용자에겐 다시 보여야 함(누락 금지).
  it("다문화 플래그를 체크하면 다문화 장학금이 다시 보여야 한다", () => {
    const damunhwa = { ...user, flags: ["다문화가족"] };
    const items = getBenefits().filter((x) => x.category === "장학금" && /다문화/.test(x.name));
    const visible = items.filter((it) => matchOne(it, damunhwa).status !== "excluded");
    expect(visible.length, "다문화 사용자에겐 다문화 장학금이 보임").toBeGreaterThan(0);
  });
  it("여성 사용자에게 임신·출산 지원은 성별로 제외되지 않아야 한다", () => {
    const female = { ...user, gender: "여성" };
    const items = getBenefits().filter((x) => /임신|출산|산모/.test(x.name) && !/난임|영유아/.test(x.name));
    // 성별 사유로 제외된 게 없어야 함(다른 사유로 제외될 순 있음)
    for (const it of items.slice(0, 8)) {
      const r = matchOne(it, female);
      expect(r.failed.some((m) => /임신·출산 지원 — 남성/.test(m)), `${it.name}`).toBe(false);
    }
  });
});
