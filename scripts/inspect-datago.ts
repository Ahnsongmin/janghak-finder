// data.go.kr 복지로 API 원응답(XML)을 그대로 출력 — 필드명 검증용.
// 실행: npx tsx scripts/inspect-datago.ts   (사전: .env.local 에 DATA_GO_KR_SERVICE_KEY)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

try {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const key = process.env.DATA_GO_KR_SERVICE_KEY;
if (!key) {
  console.error("DATA_GO_KR_SERVICE_KEY 가 .env.local 에 없습니다.");
  process.exit(1);
}

const targets = {
  central: "http://apis.data.go.kr/B554287/NationalWelfareInformationsV001/NationalWelfarelistV001",
  local: "http://apis.data.go.kr/B554287/LocalGovernmentWelfareInformationsV001/LcgvWelfarelistV001",
};

async function main() {
  for (const [name, base] of Object.entries(targets)) {
    const url = new URL(base);
    url.searchParams.set("serviceKey", key!);
    url.searchParams.set("callTp", "L");
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("numOfRows", "2");
    url.searchParams.set("srchKeyCode", "003");
    const res = await fetch(url);
    const text = await res.text();
    console.log(`\n===== ${name} (HTTP ${res.status}) =====`);
    console.log(text.slice(0, 2000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
