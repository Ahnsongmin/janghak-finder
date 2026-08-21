import universities from "@/data/universities.json";

// 사용자가 선택한 대학의 수준(4년제/전문대/대학원)을 전국대학 표준데이터의 '대학구분'에서 알아낸다.
// Benefit.univLevels(장학금의 대상 대학 수준)와 비교하는 데 사용.

type Univ = { name: string; type?: string };

const TYPE_BY_NAME = new Map((universities as Univ[]).map((u) => [u.name, u.type ?? ""]));

export type UnivLevel = "4년제" | "전문대" | "대학원";

export function univLevelOf(univName: string): UnivLevel | null {
  const t = TYPE_BY_NAME.get(univName);
  if (!t) return null;
  if (t.includes("전문대")) return "전문대";
  if (t.includes("대학원")) return "대학원";
  if (t.includes("대학")) return "4년제"; // "대학" (일반 4년제)
  return null;
}
