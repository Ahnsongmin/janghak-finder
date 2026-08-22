import universities from "@/data/universities.json";

// 사용자가 선택한 대학의 수준(4년제/전문대/대학원)과 소재 시도를 전국대학 표준데이터에서 알아낸다.
// - 수준: Benefit.univLevels(대상 대학 수준)와 비교 → 전문대 전용↔4년제 오노출 방지
// - 소재지: "OO 소재 대학 재학생" 류의 학교 소재지 조건 매칭에 사용(거주지 조건과는 별개)

type Univ = { name: string; type?: string; region?: string };

const BY_NAME = new Map(
  (universities as Univ[]).map((u) => [u.name, { type: u.type ?? "", region: u.region ?? "" }]),
);

export type UnivLevel = "4년제" | "전문대" | "대학원";

export function univLevelOf(univName: string): UnivLevel | null {
  const t = BY_NAME.get(univName)?.type;
  if (!t) return null;
  if (t.includes("전문대")) return "전문대";
  if (t.includes("대학원")) return "대학원";
  if (t.includes("대학")) return "4년제"; // "대학" (일반 4년제)
  return null;
}

/** 대학 소재 시도명(예: "서울특별시"). 미상이면 null */
export function univRegionOf(univName: string): string | null {
  return BY_NAME.get(univName)?.region || null;
}
