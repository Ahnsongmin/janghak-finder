// 토스페이먼츠 결제 승인 + 이용권 코드 발급.
// 클라이언트가 successUrl로 받은 paymentKey/orderId/amount를 보내면
// ① 금액이 패키지 정가와 일치하는지 검증 ② 토스 승인 API 호출(1회만 성공)
// ③ Supabase에 이용권 발급. orderId 유니크라 재호출돼도 중복 발급 없음.

import { z } from "zod";
import { PACKS, type PackId, paywallEnabled, createCredit } from "@/lib/gate";

export const runtime = "nodejs";

const BodySchema = z.object({
  paymentKey: z.string().min(1).max(200),
  orderId: z.string().min(6).max(64),
  amount: z.number().int().positive(),
});

export async function POST(req: Request) {
  if (!paywallEnabled()) {
    return Response.json({ error: "DISABLED", message: "결제가 아직 준비되지 않았어요." }, { status: 503 });
  }

  let body;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return Response.json({ error: "BAD_INPUT", message: "결제 정보를 확인해 주세요." }, { status: 400 });
  }

  // orderId 형식: jf<packId>-<랜덤> — 패키지를 orderId에 인코딩해 금액 위변조 차단
  const pack = PACKS[body.orderId.match(/^jf(p\d)-/)?.[1] as PackId];
  if (!pack || pack.amount !== body.amount) {
    return Response.json({ error: "AMOUNT_MISMATCH", message: "결제 금액이 올바르지 않아요." }, { status: 400 });
  }

  const auth = Buffer.from(`${process.env.TOSS_SECRET_KEY}:`).toString("base64");
  const tossRes = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!tossRes.ok) {
    const err = (await tossRes.json().catch(() => ({}))) as { message?: string };
    return Response.json(
      { error: "CONFIRM_FAILED", message: err.message ?? "결제 승인에 실패했어요." },
      { status: 402 },
    );
  }

  try {
    const credit = await createCredit({
      orderId: body.orderId,
      paymentKey: body.paymentKey,
      amount: body.amount,
      credits: pack.credits,
    });
    return Response.json(credit);
  } catch (e) {
    // 승인은 됐는데 발급 실패(이중 호출 포함) — 운영자 확인 필요
    console.error("credit issue failed:", e);
    return Response.json(
      { error: "ISSUE_FAILED", message: "결제는 완료됐지만 이용권 발급에 문제가 생겼어요. 문의해 주시면 바로 처리해 드릴게요." },
      { status: 500 },
    );
  }
}
