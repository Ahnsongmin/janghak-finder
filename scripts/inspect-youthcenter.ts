// 온통청년 API 응답 1건을 그대로 출력해 "실제 필드명"을 눈으로 확인하는 스크립트.
// 어댑터의 필드 매핑(lib/sources/youthcenter.ts)이 실제 응답과 맞는지 검증할 때 사용.
// 실행: npx tsx scripts/inspect-youthcenter.ts   (사전: .env.local 에 YOUTHCENTER_API_KEY)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

try {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const key = process.env.YOUTHCENTER_API_KEY;
if (!key) {
  console.error("YOUTHCENTER_API_KEY 가 .env.local 에 없습니다.");
  process.exit(1);
}

async function main() {
  const url = new URL("https://www.youthcenter.go.kr/go/ythip/getPlcy");
  url.searchParams.set("apiKeyNm", key!);
  url.searchParams.set("rtnType", "json");
  url.searchParams.set("pageNum", "1");
  url.searchParams.set("pageSize", "1");

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  console.log("HTTP", res.status);
  const data = await res.json();
  console.dir(data, { depth: 6 });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
