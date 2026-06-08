import type { Benefit } from "../types";
import { lawdCodeToSido } from "../options";

// ── 출처 어댑터: 온통청년(youthcenter.go.kr) 청년정책 OpenAPI ──
// 공공데이터포털 "한국고용정보원_온통청년_청년정책API" 기반.
// 인증키(apiKeyNm)는 온통청년 마이페이지에서 발급 → .env.local 의 YOUTHCENTER_API_KEY 로 주입.
//
// ⚠️ 검증 필요: 아래 요청 파라미터/응답 필드명은 공개 명세 기준으로 작성했으나,
//    실제 인증키로 1회 호출해 응답 JSON을 캡처한 뒤(scripts/inspect-youthcenter.mjs)
//    필드명을 반드시 대조·확정할 것. 필드가 다르면 매핑만 고치면 된다(데이터 위조 아님).

const ENDPOINT = "https://www.youthcenter.go.kr/go/ythip/getPlcy";

interface RawPolicy {
  plcyNo?: string;
  plcyNm?: string;
  plcyKywdNm?: string;
  plcyExplnCn?: string;
  plcySprtCn?: string; // 정책지원내용
  sprvsnInstCdNm?: string; // 주관기관명
  operInstCdNm?: string; // 운영기관명
  aplyYmd?: string; // 신청기간
  aplyUrlAddr?: string; // 신청 사이트 주소
  refUrlAddr1?: string;
  refUrlAddr2?: string;
  plcyAplyMthdCn?: string; // 신청방법 내용
  srngMthdCn?: string; // 심사방법 내용
  sbmsnDcmntCn?: string; // 제출서류 내용
  addAplyQlfcCndCn?: string; // 추가 신청자격 조건 내용
  sprtTrgtMinAge?: string; // 지원대상 최소연령
  sprtTrgtMaxAge?: string; // 지원대상 최대연령
  earnCndSeCd?: string; // 소득조건 구분코드 (0043001 무관/0043002 연소득/0043003 기타)
  earnMinAmt?: string;
  earnMaxAmt?: string;
  earnEtcCn?: string; // 소득 기타 내용
  zipCd?: string; // 거주지역(법정동코드) 콤마구분
  schoolCd?: string; // 학력요건 코드
  plcyMajorCd?: string; // 전공요건 코드
}

interface ApiResponse {
  resultCode?: number;
  resultMessage?: string;
  result?: {
    pagging?: { totCount?: number; pageNum?: number; pageSize?: number };
    youthPolicyList?: RawPolicy[];
  };
}

function toInt(s?: string): number | null {
  if (!s) return null;
  const n = parseInt(s.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/** zipCd(법정동코드 콤마목록) → 중복 제거된 시도명 배열. 없으면 ["전국"] */
function zipToRegions(zipCd?: string): string[] {
  if (!zipCd || !zipCd.trim()) return ["전국"];
  const sidos = new Set<string>();
  for (const code of zipCd.split(",")) {
    const sido = lawdCodeToSido(code);
    if (sido) sidos.add(sido);
  }
  return sidos.size > 0 ? [...sidos] : ["전국"];
}

function normalize(raw: RawPolicy, fetchedAt: string): Benefit {
  const refUrls = [raw.refUrlAddr1, raw.refUrlAddr2].filter((u): u is string => !!u && u.trim() !== "");
  // 소득: 청년정책은 "연소득 금액" 기준이라 학자금 분위로 환산 불가 → incomeMax는 null, 원문은 note로.
  const incomeNote =
    raw.earnCndSeCd === "0043002"
      ? `연소득 ${raw.earnMinAmt ?? "?"}~${raw.earnMaxAmt ?? "?"}`
      : raw.earnEtcCn || undefined;

  const rawConditionText = [
    raw.plcySprtCn && `[지원내용] ${raw.plcySprtCn}`,
    raw.addAplyQlfcCndCn && `[추가 자격조건] ${raw.addAplyQlfcCndCn}`,
    raw.earnEtcCn && `[소득조건] ${raw.earnEtcCn}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    id: `youthcenter:${raw.plcyNo ?? raw.plcyNm ?? Math.random().toString(36).slice(2)}`,
    name: raw.plcyNm?.trim() || "(이름 미상)",
    category: "지원금",
    provider: raw.sprvsnInstCdNm || raw.operInstCdNm || "미상",
    sourceName: "온통청년",
    description: raw.plcyExplnCn?.trim() || undefined,
    regions: zipToRegions(raw.zipCd),
    incomeMax: null,
    incomeNote: raw.earnCndSeCd && raw.earnCndSeCd !== "0043001" ? incomeNote : undefined,
    ageMin: toInt(raw.sprtTrgtMinAge),
    ageMax: toInt(raw.sprtTrgtMaxAge),
    eduStatus: [], // 학력요건 코드 매핑은 실제 코드표 확인 후 추가 (현재는 무관 처리)
    grades: [],
    requiredFlags: [],
    targetGroups: [],
    applyPeriod: raw.aplyYmd?.trim() || undefined,
    applyMethod: raw.plcyAplyMthdCn?.trim() || undefined,
    submitDocs: raw.sbmsnDcmntCn?.trim() || undefined,
    applyUrl: raw.aplyUrlAddr?.trim() || undefined,
    refUrls: refUrls.length ? refUrls : undefined,
    rawConditionText: rawConditionText || undefined,
    lastFetchedAt: fetchedAt,
  };
}

/** 청년정책 전체를 페이지네이션으로 모두 수집해 정규화된 Benefit 배열로 반환 */
export async function fetchYouthCenter(apiKey: string, pageSize = 100): Promise<Benefit[]> {
  const fetchedAt = new Date().toISOString();
  const out: Benefit[] = [];
  let pageNum = 1;

  while (true) {
    const url = new URL(ENDPOINT);
    url.searchParams.set("apiKeyNm", apiKey);
    url.searchParams.set("rtnType", "json");
    url.searchParams.set("pageNum", String(pageNum));
    url.searchParams.set("pageSize", String(pageSize));

    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`온통청년 API HTTP ${res.status}`);
    const data = (await res.json()) as ApiResponse;

    const list = data.result?.youthPolicyList ?? [];
    if (list.length === 0) break;
    out.push(...list.map((r) => normalize(r, fetchedAt)));

    const total = data.result?.pagging?.totCount ?? out.length;
    if (out.length >= total || pageNum > 200) break;
    pageNum += 1;
  }

  return out;
}
