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

// 원문에 적힌 특정 대학명 찾기 (예: "서울대학교 3학년 재학생", "부산대 부경대 동아대").
// 실제 전국대학 표준데이터에 있는 이름만 인정하므로 "국내 대학"·"정규 대학" 같은 일반 표현은 걸리지 않는다.
const normalize = (s: string) => s.replace(/여자대학교|여자대학|여대|대학교|대학|\s|\(.*?\)/g, "");

const BY_NORM = new Map<string, string>();
for (const u of universities as Univ[]) {
  // 표준데이터는 "국립한국해양대학교"처럼 설립구분 접두어가 붙어 있지만
  // 공고문에는 "한국해양대"로 적히므로 접두어를 뗀 별칭도 함께 등록한다.
  for (const key of [normalize(u.name), normalize(u.name.replace(/^(?:국립|공립|사립)/, ""))]) {
    if (key.length >= 2 && !BY_NORM.has(key)) BY_NORM.set(key, u.name);
  }
}

/** 텍스트에 등장하는 실제 대학명 목록(정식명칭으로 정규화). 없으면 빈 배열 */
export function findUnivNames(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/([가-힣]{2,10}?)(?:여자대학교|여대|대학교|대(?![가-힣]))/g)) {
    const canonical = BY_NORM.get(m[1]);
    if (canonical) found.add(canonical);
  }
  return [...found];
}
