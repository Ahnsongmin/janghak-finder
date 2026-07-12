// AI 지원서 초안 생성 API — 2단계 파이프라인으로 품질을 끌어올린다.
//   1차(논스트리밍): 키워드로 초안 작성 (effort low, 빠르게)
//   2차(스트리밍):   까다로운 첨삭자가 AI티·상투어를 잡아 다시 씀 (effort high, 공들임)
// 키(ANTHROPIC_API_KEY)가 없으면 503 + 안내 — 키 없이도 앱은 동작하고 이 기능만 비활성.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  DRAFT_TONES,
  systemFor,
  reviseSystemFor,
  buildDraftUserPrompt,
  buildReviseUserPrompt,
  maxTokensFor,
  type DraftInput,
} from "@/lib/draft-prompt";
import { paywallEnabled, isFreeUsed, useCredit, refundCredit, FREE_COOKIE, freeCookieValue } from "@/lib/gate";

export const runtime = "nodejs";
// 2단계(작성+첨삭) Opus 호출 — Hobby 플랜 함수 한도(60s)에 맞춤.
export const maxDuration = 60;

const MODEL = "claude-opus-4-8";

const BodySchema = z.object({
  scholarship: z.string().max(200).optional(),
  question: z.string().min(1).max(1000),
  maxChars: z.number().int().min(100).max(3000),
  keywords: z.string().min(1).max(4000),
  profile: z.string().max(2000).optional(),
  tone: z.enum(DRAFT_TONES),
  creditCode: z.string().max(40).optional(),
});

/** 메시지 응답에서 텍스트 블록만 이어붙인다(사고 블록 제외). */
function textOf(msg: Anthropic.Message): string {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      {
        error: "NO_KEY",
        message: "AI 작성 엔진을 점검하고 있어요. 잠시 후 다시 시도해 주세요.",
      },
      { status: 503 },
    );
  }

  let parsed;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch (e) {
    return Response.json(
      { error: "BAD_INPUT", message: "입력값을 확인해 주세요.", detail: (e as Error).message },
      { status: 400 },
    );
  }
  // ── 유료 게이트: 첫 1건 무료(서명 쿠키) → 이후 이용권 코드 차감 ──
  // 결제/DB env가 없으면 게이트 꺼짐(기존 무료 동작). 생성 실패 시 차감 복구.
  let usedCode: string | null = null;
  let grantFree = false;
  if (paywallEnabled()) {
    if (parsed.creditCode) {
      const remaining = await useCredit(parsed.creditCode);
      if (remaining < 0) {
        return Response.json(
          { error: "NO_CREDIT", message: "이용권이 모두 소진됐어요. 이용권을 구매하면 바로 이어서 쓸 수 있어요." },
          { status: 402 },
        );
      }
      usedCode = parsed.creditCode;
    } else if (!isFreeUsed(req.headers.get("cookie"))) {
      grantFree = true;
    } else {
      return Response.json(
        { error: "PAYMENT_REQUIRED", message: "무료 1회를 이미 사용했어요. 이용권을 구매하면 계속 쓸 수 있어요." },
        { status: 402 },
      );
    }
  }

  const input = parsed as DraftInput;
  const client = new Anthropic({ apiKey });
  const maxTokens = maxTokensFor(input.maxChars);

  // ── 1차: 초안 작성 (논스트리밍 — 응답 전에 끝내서, 실패 시 무료/이용권을 소진하지 않음) ──
  let draft = "";
  try {
    const first = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: systemFor(input.tone),
      messages: [{ role: "user", content: buildDraftUserPrompt(input) }],
    });
    draft = textOf(first);
  } catch (e) {
    if (usedCode) await refundCredit(usedCode).catch(() => {});
    return Response.json(
      { error: "GEN_FAILED", message: `초안 생성에 실패했어요. 잠시 후 다시 시도해 주세요. (사용 횟수는 차감되지 않았어요) — ${(e as Error).message}` },
      { status: 502 },
    );
  }
  if (!draft) {
    if (usedCode) await refundCredit(usedCode).catch(() => {});
    return Response.json(
      { error: "GEN_FAILED", message: "초안 생성에 실패했어요. 키워드를 조금 더 적어 다시 시도해 주세요. (사용 횟수는 차감되지 않았어요)" },
      { status: 502 },
    );
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // ── 2차: 첨삭 재작성 (스트리밍, 공들임) ──
        const stream = client.messages.stream({
          model: MODEL,
          max_tokens: maxTokens,
          thinking: { type: "adaptive" },
          output_config: { effort: "high" },
          system: reviseSystemFor(input.tone),
          messages: [{ role: "user", content: buildReviseUserPrompt(input, draft) }],
        });
        stream.on("text", (t) => controller.enqueue(encoder.encode(t)));
        await stream.finalMessage();
      } catch (e) {
        if (usedCode) await refundCredit(usedCode).catch(() => {});
        controller.enqueue(encoder.encode(`\n\n[생성 중 오류] ${(e as Error).message} (이용권은 차감되지 않았어요)`));
      } finally {
        controller.close();
      }
    },
  });

  const headers: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
  };
  if (grantFree) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    headers["Set-Cookie"] = `${FREE_COOKIE}=${freeCookieValue()}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`;
  }
  return new Response(body, { headers });
}
