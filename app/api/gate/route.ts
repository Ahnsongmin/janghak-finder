// 게이트 상태 조회 — 클라이언트가 결제 UI를 그릴지/무료 안내를 할지 판단.
// ?code=JF-… 를 주면 이용권 잔여도 같이 알려준다.

import { paywallEnabled, isFreeUsed, getCredit, PACKS } from "@/lib/gate";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const enabled = paywallEnabled();
  const code = new URL(req.url).searchParams.get("code");
  return Response.json({
    enabled,
    freeUsed: enabled ? isFreeUsed(req.headers.get("cookie")) : false,
    remaining: enabled && code ? await getCredit(code) : null,
    clientKey: process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? null,
    packs: PACKS,
  });
}
