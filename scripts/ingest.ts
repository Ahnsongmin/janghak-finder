// 정부 공식 API에서 장학금/지원금을 수집해 data/policies.json 으로 정규화 저장.
// 실행: npm run ingest   (사전: .env.local 에 YOUTHCENTER_API_KEY 설정)
//
// 키가 없으면 수집을 건너뛰고, 기존 예시(demo) 데이터를 그대로 둔다(데이터 위조 방지).

import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchYouthCenter } from "../lib/sources/youthcenter";
import { fetchBokjiro } from "../lib/sources/bokjiro";
import { fetchUniversities } from "../lib/sources/univ";
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

  // 출처별로 독립 실행: 한 곳이 실패해도(키 미활성 등) 나머지는 수집되도록 try/catch.
  const youthKey = process.env.YOUTHCENTER_API_KEY;
  if (youthKey) {
    try {
      console.log("[온통청년] 수집 시작…");
      const policies = await fetchYouthCenter(youthKey);
      collected.push(...policies);
      sources.push(`온통청년 ${policies.length}건`);
      console.log(`[온통청년] ${policies.length}건 수집`);
    } catch (e) {
      console.error("[온통청년] 실패:", (e as Error).message);
    }
  } else {
    console.warn("⚠️  YOUTHCENTER_API_KEY 없음 → 온통청년 건너뜀");
  }

  const dataKey = process.env.DATA_GO_KR_SERVICE_KEY;
  if (dataKey) {
    for (const kind of ["central", "local"] as const) {
      try {
        console.log(`[복지로:${kind}] 수집 시작…`);
        const items = await fetchBokjiro(dataKey, kind);
        collected.push(...items);
        sources.push(`복지로(${kind}) ${items.length}건`);
        console.log(`[복지로:${kind}] ${items.length}건 수집`);
      } catch (e) {
        console.error(`[복지로:${kind}] 실패:`, (e as Error).message);
      }
    }
  } else {
    console.warn("⚠️  DATA_GO_KR_SERVICE_KEY 없음 → 복지로 건너뜀");
  }

  // 전국 대학 목록(입력 폼 '대학 선택'용) → data/universities.json 에 별도 저장
  if (dataKey) {
    try {
      console.log("[전국대학] 수집 시작…");
      const univs = await fetchUniversities(dataKey);
      const uniqByName = [...new Map(univs.map((u) => [u.name, u])).values()];
      // 0건이면 기존 파일 유지 — API 장애·응답구조 변경 시 대학 선택 폼이 통째로 비는 사고 방지
      if (uniqByName.length === 0) {
        console.warn("⚠️  [전국대학] 0건 수집 → 기존 universities.json 유지");
      } else {
        writeFileSync(
          resolve(process.cwd(), "data", "universities.json"),
          JSON.stringify(uniqByName, null, 2),
          "utf8",
        );
        console.log(`[전국대학] ${univs.length}건 수집 → 중복제거 ${uniqByName.length}개 저장`);
      }
    } catch (e) {
      console.error("[전국대학] 실패:", (e as Error).message);
    }
  }

  // TODO(후속): 한국장학재단, 대학별 교내장학금(공개 API 없음 → 스크래핑 별도 검토)

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
