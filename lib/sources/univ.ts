// ── 출처 어댑터: 전국대학및전문대학정보 표준데이터 (행안부/대교협, data.go.kr) ──
// 전국 모든 대학 목록(학교명·구분·시도·설립·홈페이지). 입력 폼의 '대학 선택'에 사용.
// 인증키: DATA_GO_KR_SERVICE_KEY (복지로와 공통). 엔드포인트는 JSON 지원(type=json).
//
// 주의: 개별 '교내장학금'은 이 API(및 어떤 공개 API)에도 없음 — 대학 '목록'까지만 제공.

const ENDPOINT = "https://api.data.go.kr/openapi/tn_pubr_public_univ_info_api";

export interface University {
  name: string; // 학교명
  type: string; // 대학구분 (대학/전문대학/대학원 등)
  schoolType: string; // 학교구분 (일반대학/산업대학/일반대학원 등)
  region: string; // 시도명
  foundation: string; // 설립 (국립/공립/사립)
  branch: string; // 본교/분교
  homepage?: string;
  address?: string;
}

interface RawUniv {
  schlNm?: string;
  univSeNm?: string;
  schlSeNm?: string;
  fndnFormSeNm?: string;
  mainbranchNm?: string;
  ctpvNm?: string;
  hmpgAddr?: string;
  lctnRoadNmAddr?: string;
}

// 2026-08 현재 응답: {header, body:{items:{item:[...]}}} — 과거의 response 래퍼 형태도 함께 지원
interface ApiBody {
  totalCount?: number | string;
  items?: RawUniv[] | { item?: RawUniv[] };
}
interface ApiResponse {
  header?: { resultCode?: string; resultMsg?: string };
  body?: ApiBody;
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: ApiBody;
  };
}

function extractBody(data: ApiResponse): { items: RawUniv[]; total: number | undefined } {
  const body = data.body ?? data.response?.body;
  const rawItems = body?.items;
  const items = Array.isArray(rawItems) ? rawItems : (rawItems?.item ?? []);
  const total = body?.totalCount !== undefined ? Number(body.totalCount) : undefined;
  return { items, total };
}

function normalizeHomepage(url?: string): string | undefined {
  if (!url || !url.trim()) return undefined;
  const u = url.trim();
  return /^https?:\/\//.test(u) ? u : `https://${u}`;
}

function normalize(r: RawUniv): University {
  return {
    name: r.schlNm?.trim() || "(이름 미상)",
    type: r.univSeNm?.trim() || "",
    schoolType: r.schlSeNm?.trim() || "",
    region: r.ctpvNm?.trim() || "",
    foundation: r.fndnFormSeNm?.trim() || "",
    branch: r.mainbranchNm?.trim() || "",
    homepage: normalizeHomepage(r.hmpgAddr),
    address: r.lctnRoadNmAddr?.trim() || undefined,
  };
}

/** 전국 대학 전체를 페이지네이션으로 수집 */
export async function fetchUniversities(serviceKey: string, numOfRows = 500): Promise<University[]> {
  const out: University[] = [];
  let pageNo = 1;

  while (true) {
    const url = new URL(ENDPOINT);
    url.searchParams.set("serviceKey", serviceKey);
    url.searchParams.set("type", "json");
    url.searchParams.set("pageNo", String(pageNo));
    url.searchParams.set("numOfRows", String(numOfRows));

    // 빌드 중 일시적 네트워크 실패 대비 재시도(백오프)
    let data: ApiResponse | null = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          data = (await res.json()) as ApiResponse;
          break;
        }
        if (attempt === 4) throw new Error(`대학 표준데이터 HTTP ${res.status}`);
      } catch (e) {
        if (attempt === 4) throw e;
      }
      await new Promise((r) => setTimeout(r, attempt * 800));
    }
    if (!data) break;

    const { items, total } = extractBody(data);
    if (items.length === 0) break;
    out.push(...items.map(normalize));

    if (out.length >= (total ?? out.length) || pageNo > 50) break;
    pageNo += 1;
  }

  return out;
}
