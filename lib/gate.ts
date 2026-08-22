// AI 지원서 유료 게이트 — 로그인 없는 "이용권 코드" 모델.
//   무료 1건: HMAC 서명 쿠키로 사용 여부 표시 (DB 불필요)
//   유료: 토스 결제 승인 → Supabase jf_credits에 코드 발급 → 코드로 차감
// 결제/DB env가 하나라도 없으면 게이트 자체가 꺼져 기존(무료) 동작 유지.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const PACKS = {
  p1: { credits: 1, amount: 2900, name: "AI 지원서 이용권 1건" },
  p3: { credits: 3, amount: 6900, name: "AI 지원서 이용권 3건" },
} as const;
export type PackId = keyof typeof PACKS;

export const FREE_COOKIE = "jf_free";

export function paywallEnabled(): boolean {
  if (process.env.PAYWALL_DISABLED === "1") return false;
  return Boolean(
    process.env.TOSS_SECRET_KEY &&
      process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY &&
      process.env.SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

// ── 무료 1건 쿠키 ──────────────────────────────────────────────
function gateSecret(): string {
  return process.env.GATE_SECRET ?? process.env.TOSS_SECRET_KEY ?? "jf-dev-secret";
}

export function freeCookieValue(): string {
  return createHmac("sha256", gateSecret()).update("jf-free-used").digest("hex");
}

export function isFreeUsed(cookieHeader: string | null): boolean {
  const m = cookieHeader?.match(new RegExp(`(?:^|;\\s*)${FREE_COOKIE}=([^;]+)`));
  if (!m) return false;
  const got = Buffer.from(m[1]);
  const want = Buffer.from(freeCookieValue());
  return got.length === want.length && timingSafeEqual(got, want);
}

// ── Supabase REST (service role, 서버 전용) ────────────────────
async function sb(path: string, init: RequestInit): Promise<Response> {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

/** 결제 승인 후 이용권 코드 발급. orderId 유니크 제약으로 중복 발급 방지. */
export async function createCredit(opts: {
  orderId: string;
  paymentKey: string;
  amount: number;
  credits: number;
}): Promise<{ code: string; remaining: number }> {
  const code = `JF-${randomBytes(6).toString("hex").toUpperCase()}`;
  const res = await sb("/rest/v1/jf_credits", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      code,
      order_id: opts.orderId,
      payment_key: opts.paymentKey,
      amount: opts.amount,
      total: opts.credits,
      remaining: opts.credits,
    }),
  });
  if (!res.ok) throw new Error(`이용권 발급 실패 (${res.status}): ${await res.text()}`);
  return { code, remaining: opts.credits };
}

/** 이용권 1건 차감. 성공 시 남은 건수(0 이상), 잔여 없음/코드 오류면 -1. */
export async function useCredit(code: string): Promise<number> {
  const res = await sb("/rest/v1/rpc/jf_use_credit", {
    method: "POST",
    body: JSON.stringify({ p_code: code }),
  });
  if (!res.ok) throw new Error(`이용권 확인 실패 (${res.status})`);
  return (await res.json()) as number;
}

/** 생성 실패 시 차감 복구. */
export async function refundCredit(code: string): Promise<void> {
  await sb("/rest/v1/rpc/jf_refund_credit", {
    method: "POST",
    body: JSON.stringify({ p_code: code }),
  });
}

/** 코드 잔여 조회(클라이언트 표시용). 없는 코드는 null. */
export async function getCredit(code: string): Promise<number | null> {
  const res = await sb(`/rest/v1/jf_credits?code=eq.${encodeURIComponent(code)}&select=remaining`, {
    method: "GET",
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as { remaining: number }[];
  return rows[0]?.remaining ?? null;
}
