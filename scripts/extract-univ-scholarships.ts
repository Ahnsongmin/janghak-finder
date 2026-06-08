// 대학 공식 장학 페이지를 AI(Claude)가 읽어 교내장학금을 구조화 추출 → university-scholarships.json 갱신.
// 실행: npm run extract:univ   (사전: .env.local 에 ANTHROPIC_API_KEY)
//
// 핵심 원칙: 페이지에 "실제로 적힌 것만" 추출(지어내기 금지). 출처 URL·수집일 함께 저장.
// 비용: 대학 1곳당 약 $0.01~0.03 (기본 Haiku). UNIV_EXTRACT_MODEL 로 모델 변경 가능.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Benefit } from "../lib/types";
import { SPECIAL_FLAGS } from "../lib/options";

function loadEnv() {
  try {
    const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

const MODEL = process.env.UNIV_EXTRACT_MODEL || "claude-haiku-4-5";

// 페이지 HTML → 텍스트 (script/style 제거, 태그 제거, 공백 정리, 길이 제한)
async function fetchPageText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; janghak-finder/1.0)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 40000);
}

// AI 추출 결과 스키마 (구조화 출력)
const Extracted = z.object({
  scholarships: z.array(
    z.object({
      name: z.string().describe("장학금 정확한 명칭"),
      audience: z.string().describe("지원 대상 요약 (예: 성적우수, 가계곤란, 봉사, 근로, 보훈, 장애 등)"),
      forNewStudent: z.boolean().describe("신입생 전용이면 true"),
      requiredFlags: z
        .array(z.string())
        .describe("특수자격 키워드(있으면): 장애, 보훈, 북한이탈, 기초수급, 차상위, 다자녀, 한부모, 다문화 중 해당"),
      incomeRelated: z.boolean().describe("가계곤란/소득 연계 여부"),
      departments: z
        .array(z.string())
        .describe("특정 학과/전공 전용이면 해당 학과명(예: 전자공학, 인공지능). 전체 학과 대상이면 빈 배열"),
      amount: z.string().describe("지원 금액 (예: 등록금 전액, 반액, 일정액). 없으면 빈 문자열"),
      conditionText: z.string().describe("자격조건 원문 요약 (학점·평점·기타). 페이지에 적힌 사실만"),
    }),
  ),
});

const FLAG_MAP: [string, string][] = [
  ["장애", "장애인(본인/가족)"],
  ["보훈", "국가보훈대상자"],
  ["북한이탈", "북한이탈주민"],
  ["탈북", "북한이탈주민"],
  ["기초", "기초생활수급자"],
  ["수급", "기초생활수급자"],
  ["차상위", "차상위계층"],
  ["다자녀", "다자녀가구(3자녀 이상)"],
  ["한부모", "한부모가족"],
  ["다문화", "다문화가족"],
];

function normalizeFlags(raw: string[]): string[] {
  const out = new Set<string>();
  for (const r of raw) {
    for (const [kw, flag] of FLAG_MAP) if (r.includes(kw)) out.add(flag);
    if ((SPECIAL_FLAGS as readonly string[]).includes(r)) out.add(r);
  }
  return [...out];
}

function slug(university: string): string {
  return university.replace(/대학교|대학/g, "").replace(/\s/g, "");
}

async function extractOne(
  client: Anthropic,
  university: string,
  url: string,
  fetchedAt: string,
): Promise<Benefit[]> {
  const pageText = await fetchPageText(url);

  const result = await client.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    system:
      "너는 한국 대학 장학금 페이지에서 '교내장학금' 정보를 정확히 추출하는 도우미다. " +
      "반드시 페이지에 실제로 적힌 내용만 추출하고, 적혀 있지 않은 금액·조건은 지어내지 말고 빈 값으로 둬라. " +
      "국가장학금·외부(교외)장학금·대출은 제외하고, 그 대학이 운영하는 교내장학금만 추출하라.",
    messages: [
      {
        role: "user",
        content: `다음은 ${university}의 장학 안내 페이지 텍스트다. 교내장학금 목록을 추출해줘.\n\n---\n${pageText}`,
      },
    ],
    output_config: { format: zodOutputFormat(Extracted) },
  });

  const data = result.parsed_output;
  if (!data) throw new Error("구조화 출력 파싱 실패");

  return data.scholarships.map((s, i) => ({
    id: `univ:${slug(university)}:${i}`,
    name: s.name.trim(),
    category: "장학금" as const,
    provider: university,
    sourceName: `${university}(교내)`,
    university,
    description: s.audience?.trim() || undefined,
    regions: ["전국"],
    incomeMax: null,
    incomeNote: s.incomeRelated ? "가계곤란/소득 연계" : undefined,
    ageMin: null,
    ageMax: null,
    eduStatus: s.forNewStudent ? ["신입생/예비대학생"] : ["대학생(재학)"],
    grades: [],
    requiredFlags: normalizeFlags(s.requiredFlags ?? []),
    targetGroups: [],
    departments: (s.departments ?? []).filter((d) => d.trim()),
    amount: s.amount?.trim() || undefined,
    applyUrl: url,
    rawConditionText:
      [s.audience && `[대상] ${s.audience}`, s.conditionText && `[조건] ${s.conditionText}`]
        .filter(Boolean)
        .join("\n") || undefined,
    lastFetchedAt: fetchedAt,
  }));
}

async function main() {
  loadEnv();
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("⚠️  ANTHROPIC_API_KEY 없음 → .env.local 에 추가하세요.");
    process.exit(1);
  }
  const client = new Anthropic();
  const fetchedAt = new Date().toISOString().slice(0, 10);

  const sources: { university: string; urls: string[] }[] = JSON.parse(
    readFileSync(resolve(process.cwd(), "data", "univ-sources.json"), "utf8"),
  );

  const all: Benefit[] = [];
  for (const src of sources) {
    for (const url of src.urls) {
      try {
        console.log(`[${src.university}] 추출 중… (${MODEL}) ${url}`);
        const items = await extractOne(client, src.university, url, fetchedAt);
        all.push(...items);
        console.log(`  → ${items.length}개 추출`);
      } catch (e) {
        console.error(`  ✗ 실패: ${(e as Error).message}`);
      }
    }
  }

  if (all.length === 0) {
    console.warn("추출된 항목이 없습니다. 기존 파일을 유지합니다.");
    return;
  }

  const out = resolve(process.cwd(), "data", "university-scholarships.json");
  writeFileSync(out, JSON.stringify(all, null, 2), "utf8");
  console.log(`\n✅ 총 ${all.length}개 저장 → ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
