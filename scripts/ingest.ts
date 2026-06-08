// 정부 공식 API에서 장학금/지원금을 수집해 data/policies.json 으로 정규화 저장.
// 실행: npm run ingest   (사전: .env.local 에 YOUTHCENTER_API_KEY 설정)
//
// 키가 없으면 수집을 건너뛰고, 기존 예시(demo) 데이터를 그대로 둔다(데이터 위조 방지).

import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchYouthCenter } from "../lib/sources/youthcenter";
import type { Benefit } from "../lib/types";

function loadEnv() {
  // .env.local 의 KEY=VALUE 를 간단 파싱 (dotenv 의존성 없이)
  try {
    const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* .env.local 없으면 무시 */
  }
}

async function main() {
  loadEnv();
  const collected: Benefit[] = [];
  const sources: string[] = [];

  const youthKey = process.env.YOUTHCENTER_API_KEY;
  if (youthKey) {
    console.log("[온통청년] 수집 시작…");
    const policies = await fetchYouthCenter(youthKey);
    collected.push(...policies);
    sources.push(`온통청년 ${policies.length}건`);
    console.log(`[온통청년] ${policies.length}건 수집`);
  } else {
    console.warn("⚠️  YOUTHCENTER_API_KEY 없음 → 온통청년 수집 건너뜀");
  }

  // TODO(후속): 복지로/보조금24, 대학알리미, 한국장학재단 어댑터 추가

  if (collected.length === 0) {
    console.warn("수집된 실데이터가 없습니다. 예시(demo) 데이터를 유지합니다.");
    return;
  }

  const out = resolve(process.cwd(), "data", "policies.json");
  writeFileSync(out, JSON.stringify(collected, null, 2), "utf8");
  console.log(`✅ ${collected.length}건 저장 → ${out}`);
  console.log(`   출처: ${sources.join(", ")}`);
}

main().catch((e) => {
  console.error("수집 실패:", e);
  process.exit(1);
});
