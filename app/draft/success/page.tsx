"use client";

// 토스 결제 성공 리다이렉트 페이지 — 서버 승인 후 이용권 코드를 발급받아
// localStorage에 저장하고, 분실 대비로 코드를 화면에 보여준다.

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function PaySuccess() {
  const sp = useSearchParams();
  const [state, setState] = useState<"confirming" | "done" | "error">("confirming");
  const [message, setMessage] = useState("");
  const [code, setCode] = useState("");
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const paymentKey = sp.get("paymentKey");
    const orderId = sp.get("orderId");
    const amount = Number(sp.get("amount"));
    if (!paymentKey || !orderId || !amount) {
      setState("error");
      setMessage("결제 정보가 올바르지 않아요.");
      return;
    }
    fetch("/api/payment/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.message ?? "결제 승인에 실패했어요.");
        localStorage.setItem("jf_credit", JSON.stringify({ code: j.code }));
        setCode(j.code);
        setRemaining(j.remaining);
        setState("done");
      })
      .catch((e) => {
        setState("error");
        setMessage((e as Error).message);
      });
  }, [sp]);

  return (
    <main className="mx-auto w-full max-w-md px-5 py-16 text-center">
      {state === "confirming" && <p className="text-zinc-500">결제를 확인하는 중…</p>}
      {state === "done" && (
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
          <p className="mb-2 text-3xl">🎫</p>
          <h1 className="mb-1 text-lg font-bold text-zinc-900">이용권 {remaining}건이 준비됐어요</h1>
          <p className="mb-4 text-sm text-zinc-500">
            이 브라우저에 자동 저장됐어요. 다른 기기에서 쓰거나 분실에 대비해 코드를 꼭 보관하세요.
          </p>
          <p className="mb-6 rounded-lg bg-zinc-100 py-3 font-mono text-lg font-bold tracking-wider text-zinc-800">
            {code}
          </p>
          <Link
            href="/draft"
            className="block w-full rounded-xl bg-brand py-3 font-semibold text-white hover:bg-brand-strong"
          >
            지원서 쓰러 가기
          </Link>
        </div>
      )}
      {state === "error" && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-8">
          <p className="mb-3 text-sm text-red-700">⚠️ {message}</p>
          <Link href="/draft" className="text-sm text-blue-600 hover:underline">
            ← 돌아가기
          </Link>
        </div>
      )}
    </main>
  );
}

export default function PaySuccessPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-zinc-400">불러오는 중…</div>}>
      <PaySuccess />
    </Suspense>
  );
}
