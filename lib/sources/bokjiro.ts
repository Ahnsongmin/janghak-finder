import { XMLParser } from "fast-xml-parser";
import type { Benefit } from "../types";
import { SIDO } from "../options";

// ── 출처 어댑터: 복지로(복지서비스) — 한국사회보장정보원 / data.go.kr ──
// 중앙부처 복지서비스 + 지자체 복지서비스 두 종류. 둘 다 목록(callTp=L) API로 수집.
// 인증키는 .env.local 의 DATA_GO_KR_SERVICE_KEY (대학알리미와 공통).
//
// ⚠️ 검증 필요: 응답은 XML이며 아래 필드명(servNm, servDgst, ctpvNm 등)은 공개 명세 기준이다.
//    키 활성화 후 scripts/inspect-datago.ts 로 실제 응답을 떠서 필드명을 1회 대조할 것.
//    (필드가 다르면 매핑만 고친다 — 데이터 위조 아님)

// 경로 주의: 중앙부처는 V001, 지자체는 V001 없는 경로가 실제 동작(2026-06 실측 확인).
const ENDPOINTS = {
  central: "http://apis.data.go.kr/B554287/NationalWelfareInformationsV001/NationalWelfarelistV001",
  local: "http://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations/LcgvWelfarelist",
} as const;

export type BokjiroKind = keyof typeof ENDPOINTS;

// 필드명은 지자체 실응답으로 검증함(2026-06). 중앙부처도 동일 계열 필드 사용.
interface ServItem {
  servId?: string;
  servNm?: string; // 서비스명
  servDgst?: string; // 한줄 요약
  servDtlLink?: string; // 복지로 상세 링크
  jurMnofNm?: string; // 소관부처명 (중앙부처)
  bizChrDeptNm?: string; // 담당부서 (지자체는 "전라남도 해남군 보건소" 형태)
  ctpvNm?: string; // 시도명 (지자체)
  sggNm?: string; // 시군구명 (지자체)
  lifeNmArray?: string; // 생애주기 (콤마)
  trgterIndvdlNmArray?: string; // 대상특성 (저소득/장애인/한부모 등, 콤마)
  intrsThemaNmArray?: string; // 관심주제 (콤마)
  sprtCycNm?: string; // 지원주기
  srvPvsnNm?: string; // 제공유형 (현금지급/현물 등)
  aplyMtdNm?: string; // 신청방법
}

const parser = new XMLParser({ ignoreAttributes: true, trimValues: true });

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** 시도명 정규화: 응답이 "서울" 처럼 줄여 줄 수 있어 우리 SIDO 표기로 맞춤 */
function normalizeSido(ctpvNm?: string): string[] {
  if (!ctpvNm || !ctpvNm.trim()) return ["전국"];
  const raw = ctpvNm.trim();
  const exact = SIDO.find((s) => s === raw);
  if (exact) return [exact];
  const partial = SIDO.find((s) => s.startsWith(raw) || raw.startsWith(s.slice(0, 2)));
  return partial ? [partial] : ["전국"];
}

/** 대상특성 문자열에 저소득/수급 키워드가 있으면 소득 관련 note 생성 */
function incomeNoteFrom(trgter?: string): string | undefined {
  if (!trgter) return undefined;
  const hit = ["저소득", "기초", "수급", "차상위"].some((k) => trgter.includes(k));
  return hit ? `소득 관련 대상: ${trgter}` : undefined;
}

// 복지로 대상특성(trgterIndvdlNmArray) 키워드 → 앱 특수자격 플래그(SPECIAL_FLAGS와 일치)
const TARGET_GROUP_MAP: [string, string][] = [
  ["장애인", "장애인(본인/가족)"],
  ["한부모", "한부모가족"],
  ["조손", "한부모가족"],
  ["다자녀", "다자녀가구(3자녀 이상)"],
  ["보훈", "국가보훈대상자"],
  ["다문화", "다문화가족"],
  ["탈북", "북한이탈주민"],
  ["북한이탈", "북한이탈주민"],
];

/** 대상특성 → targetGroups(OR 조건). 매핑 안 되는 일반 대상(저소득/임산부 등)은 비워 무관 처리 */
function targetGroupsFrom(trgter?: string): string[] {
  if (!trgter) return [];
  const out = new Set<string>();
  for (const [kw, flag] of TARGET_GROUP_MAP) if (trgter.includes(kw)) out.add(flag);
  return [...out];
}

/** 생애주기(lifeNmArray)가 '노년' 전용이면 ageMin 65로 보정 → 청년/학생 결과에서 노인 전용 제거.
 *  성인 단계가 하나라도 포함되면 보정 안 함(누락 방지). */
function ageMinFromLife(life?: string): number | null {
  if (!life) return null;
  const adult = ["청년", "중장년", "청소년", "아동", "영유아", "임신", "출산"].some((k) => life.includes(k));
  return !adult && life.includes("노년") ? 65 : null;
}

function normalize(it: ServItem, kind: BokjiroKind, fetchedAt: string): Benefit {
  const conditions = [
    it.servDgst && `[요약] ${it.servDgst}`,
    it.trgterIndvdlNmArray && `[대상특성] ${it.trgterIndvdlNmArray}`,
    it.lifeNmArray && `[생애주기] ${it.lifeNmArray}`,
    it.intrsThemaNmArray && `[주제] ${it.intrsThemaNmArray}`,
    it.srvPvsnNm && `[제공유형] ${it.srvPvsnNm}`,
    it.sprtCycNm && `[지원주기] ${it.sprtCycNm}`,
    it.aplyMtdNm && `[신청방법] ${it.aplyMtdNm}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    id: `bokjiro-${kind}:${it.servId ?? it.servNm ?? Math.random().toString(36).slice(2)}`,
    name: it.servNm?.trim() || "(이름 미상)",
    category: "지원금",
    provider: it.jurMnofNm || it.bizChrDeptNm || (kind === "local" ? `${it.ctpvNm ?? ""} ${it.sggNm ?? ""}`.trim() : "정부") || "미상",
    sourceName: kind === "central" ? "복지로(중앙부처)" : "복지로(지자체)",
    description: it.servDgst?.trim() || undefined,
    regions: kind === "central" ? ["전국"] : normalizeSido(it.ctpvNm),
    incomeMax: null,
    incomeNote: incomeNoteFrom(it.trgterIndvdlNmArray),
    ageMin: ageMinFromLife(it.lifeNmArray),
    ageMax: null,
    eduStatus: [],
    grades: [],
    requiredFlags: [],
    targetGroups: targetGroupsFrom(it.trgterIndvdlNmArray),
    applyMethod: it.aplyMtdNm?.trim() || undefined,
    applyUrl: it.servDtlLink?.trim() || "https://www.bokjiro.go.kr",
    rawConditionText: conditions || undefined,
    lastFetchedAt: fetchedAt,
  };
}

export async function fetchBokjiro(serviceKey: string, kind: BokjiroKind, numOfRows = 500): Promise<Benefit[]> {
  const fetchedAt = new Date().toISOString();
  const out: Benefit[] = [];
  let pageNo = 1;

  while (true) {
    const url = new URL(ENDPOINTS[kind]);
    url.searchParams.set("serviceKey", serviceKey);
    url.searchParams.set("callTp", "L");
    url.searchParams.set("pageNo", String(pageNo));
    url.searchParams.set("numOfRows", String(numOfRows));
    url.searchParams.set("srchKeyCode", "003"); // 통합검색(전체)

    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok || text.startsWith("Forbidden") || text.includes("Unexpected")) {
      throw new Error(`복지로(${kind}) 응답 오류 HTTP ${res.status}: ${text.slice(0, 120)}`);
    }

    const json = parser.parse(text);
    const root = json.wantedList ?? json.response?.body ?? json;
    const items = asArray<ServItem>(root.servList ?? root.items?.item);
    if (items.length === 0) break;
    out.push(...items.map((it) => normalize(it, kind, fetchedAt)));

    const total = Number(root.totalCount ?? out.length);
    if (out.length >= total || pageNo > 500) break;
    pageNo += 1;
  }

  return out;
}
