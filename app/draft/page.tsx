"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DRAFT_TONES, type DraftTone } from "@/lib/draft-prompt";

type Gate = {
  enabled: boolean;
  freeUsed: boolean;
  remaining: number | null;
  clientKey: string | null;
  packs: Record<string, { credits: number; amount: number; name: string }>;
};

const CREDIT_KEY = "jf_credit";

function storedCode(): string | null {
  try {
    return (JSON.parse(localStorage.getItem(CREDIT_KEY) ?? "null") as { code?: string } | null)?.code ?? null;
  } catch {
    return null;
  }
}

/** 토스 v2 SDK를 1회 로드하고 결제창을 띄운다. successUrl로 paymentKey 등이 붙어 돌아온다. */
async function startTossPayment(clientKey: string, packId: string, pack: Gate["packs"][string]) {
  if (!document.querySelector('script[src^="https://js.tosspayments.com/v2"]')) {
    await new Promise<void>((ok, fail) => {
      const s = document.createElement("script");
      s.src = "https://js.tosspayments.com/v2/standard";
      s.onload = () => ok();
      s.onerror = () => fail(new Error("결제 모듈을 불러오지 못했어요."));
      document.head.appendChild(s);
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const TossPayments = (window as any).TossPayments;
  const payment = TossPayments(clientKey).payment({ customerKey: TossPayments.ANONYMOUS });
  const orderId = `jf${packId}-${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  await payment.requestPayment({
    method: "CARD",
    amount: { currency: "KRW", value: pack.amount },
    orderId,
    orderName: pack.name,
    successUrl: `${location.origin}/draft/success`,
    failUrl: `${location.origin}/draft?pay=fail`,
    card: { useEscrow: false, flowMode: "DEFAULT", useCardPoint: false, useAppCardOnly: false },
  });
}

const PRESETS: { label: string; question: string; chars: number }[] = [
  { label: "지원 동기", question: "이 장학금에 지원하게 된 동기를 작성해 주세요.", chars: 600 },
  { label: "자기소개", question: "본인을 소개하고 자신의 강점을 작성해 주세요.", chars: 800 },
  { label: "학업·진로 계획", question: "앞으로의 학업 계획과 진로 목표를 작성해 주세요.", chars: 600 },
  { label: "가정형편 사유", question: "가정 형편과 경제적 지원이 필요한 사유를 작성해 주세요.", chars: 500 },
];

function DraftForm() {
  const sp = useSearchParams();
  const [scholarship, setScholarship] = useState(sp.get("scholarship") ?? "");
  const [question, setQuestion] = useState("");
  const [maxChars, setMaxChars] = useState(600);
  const [keywords, setKeywords] = useState("");
  const [profile, setProfile] = useState(() => {
    // results에서 넘어온 프로필이 있으면 자동 채움
    const bits = [
      sp.get("major") && `학과: ${sp.get("major")}`,
      sp.get("region") && `거주: ${sp.get("region")}`,
      sp.get("grade") && `학년: ${sp.get("grade")}`,
    ].filter(Boolean);
    return bits.join(", ");
  });
  const [tone, setTone] = useState<DraftTone>("담백한 1인칭");

  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const [gate, setGate] = useState<Gate | null>(null);
  const [creditCode, setCreditCode] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [payError, setPayError] = useState(sp.get("pay") === "fail" ? "결제가 취소되거나 실패했어요." : "");

  useEffect(() => {
    const code = storedCode();
    setCreditCode(code);
    fetch(`/api/gate${code ? `?code=${encodeURIComponent(code)}` : ""}`)
      .then((r) => r.json())
      .then((g: Gate) => {
        setGate(g);
        setRemaining(g.remaining);
      })
      .catch(() => {});
  }, []);

  // 결제가 필요한 상태: 게이트 켜짐 + 무료 소진 + 쓸 수 있는 이용권 없음
  const needPay = Boolean(gate?.enabled && gate.freeUsed && !(creditCode && (remaining ?? 0) > 0));

  async function buyPack(packId: string) {
    if (!gate?.clientKey) return;
    setPayError("");
    try {
      await startTossPayment(gate.clientKey, packId, gate.packs[packId]);
    } catch (e) {
      // 사용자가 결제창을 닫은 경우 포함
      const msg = (e as Error).message ?? "";
      if (!/취소/.test(msg)) setPayError(msg || "결제를 시작하지 못했어요.");
    }
  }

  const [codeInput, setCodeInput] = useState("");

  async function applyCode() {
    const code = codeInput.trim().toUpperCase();
    if (!code) return;
    setPayError("");
    const g = (await fetch(`/api/gate?code=${encodeURIComponent(code)}`).then((r) => r.json())) as Gate;
    if (g.remaining === null) {
      setPayError("이용권 코드를 찾을 수 없어요. 다시 확인해 주세요.");
      return;
    }
    if (g.remaining <= 0) {
      setPayError("이 코드의 이용권은 모두 사용됐어요.");
      return;
    }
    localStorage.setItem(CREDIT_KEY, JSON.stringify({ code }));
    setCreditCode(code);
    setRemaining(g.remaining);
  }

  function applyPreset(p: (typeof PRESETS)[number]) {
    setQuestion(p.question);
    setMaxChars(p.chars);
  }

  async function generate() {
    if (!question.trim() || !keywords.trim()) {
      setError("양식 질문과 키워드는 꼭 입력해 주세요.");
      return;
    }
    setError("");
    setOutput("");
    setCopied(false);
    setLoading(true);
    const useCredit = Boolean(gate?.enabled && gate.freeUsed && creditCode && (remaining ?? 0) > 0);
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scholarship: scholarship.trim() || undefined,
          question: question.trim(),
          maxChars,
          keywords: keywords.trim(),
          profile: profile.trim() || undefined,
          tone,
          creditCode: useCredit ? creditCode : undefined,
        }),
      });

      if (res.status === 503) {
        const j = await res.json();
        setError(`⚠️ ${j.message}`);
        return;
      }
      if (res.status === 402) {
        // 서버 기준으로 무료/이용권이 소진됨 — 결제 안내로 전환
        if (useCredit) setRemaining(0);
        setGate((g) => (g ? { ...g, freeUsed: true } : g));
        return;
      }
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        setError(j.message ?? `생성에 실패했어요 (HTTP ${res.status}).`);
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        setOutput((o) => o + dec.decode(value, { stream: true }));
      }
      if (useCredit) setRemaining((r) => Math.max(0, (r ?? 1) - 1));
      else setGate((g) => (g?.enabled ? { ...g, freeUsed: true } : g));
    } catch (e) {
      setError(`오류: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function copyOut() {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const labelCls = "block text-sm font-semibold text-ink mb-1.5";
  const fieldCls =
    "w-full rounded-xl border border-zinc-200 bg-zinc-50/60 px-3.5 py-2.5 text-ink outline-none transition-all focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand/10";

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-9">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">✍️ AI 지원서 초안 쓰기</h1>
        <Link
          href="/"
          className="rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-ink/60 transition-colors hover:border-brand/40 hover:text-brand"
        >
          ← 홈
        </Link>
      </div>

      <div className="mb-6 rounded-2xl border border-violet-200/70 bg-gradient-to-br from-violet-50 to-white p-4 shadow-card">
        <p className="text-sm leading-relaxed text-ink/70">
          <strong className="text-ink">장학금 지원서에 특화된 AI</strong>가 씁니다. 작성 AI가 초안을 쓰면 첨삭 AI가
          상투어와 AI 티를 걷어내고 다시 다듬는 <strong className="text-ink">2단계 전문 파이프라인</strong>이라,
          사람이 쓴 듯 담백한 글이 나와요.
        </p>
        <p className="mt-2 text-xs text-ink/50">
          키워드 밖의 사실은 지어내지 않는 게 원칙이에요. 생성된 글은 초안이니 꼭 본인 사실로 검토·수정 후 제출하세요.
        </p>
      </div>

      <div className="space-y-5 rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-card">
        <div>
          <label className={labelCls}>
            장학금/지원금 이름 <span className="font-normal text-zinc-400">(선택)</span>
          </label>
          <input
            className={fieldCls}
            value={scholarship}
            onChange={(e) => setScholarship(e.target.value)}
            placeholder="예: 종근당고촌재단 생활비 장학금"
          />
        </div>

        <div>
          <label className={labelCls}>양식이 묻는 질문 / 작성할 항목</label>
          <div className="mb-2 flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p)}
                className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs text-zinc-600 hover:border-blue-400 hover:text-blue-600"
              >
                + {p.label}
              </button>
            ))}
          </div>
          <textarea
            className={fieldCls + " min-h-[64px] resize-y"}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="양식에 적힌 질문을 그대로 붙여넣으세요. 예: 지원 동기와 향후 계획을 기술하시오."
          />
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-3">
          <div>
            <label className={labelCls}>글자 수</label>
            <input
              type="number"
              inputMode="numeric"
              min={100}
              max={3000}
              step={100}
              className={fieldCls}
              value={maxChars}
              onChange={(e) => setMaxChars(Number(e.target.value))}
            />
          </div>
          <div>
            <label className={labelCls}>톤</label>
            <select
              className={fieldCls + " w-auto"}
              value={tone}
              onChange={(e) => setTone(e.target.value as DraftTone)}
            >
              {DRAFT_TONES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className={labelCls}>키워드 (꼭 들어갈 내용)</label>
          <textarea
            className={fieldCls + " min-h-[88px] resize-y"}
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder={"실제 사실을 짧게 적어주세요. 예:\n기계공학과 2학년, 자율주행에 관심\n아버지 실직으로 학비 부담\n로봇동아리에서 라인트레이서 제작"}
          />
          <p className="mt-1 text-xs text-zinc-400">
            여기 적은 사실만 글에 들어가요. 지어내길 원치 않는 게 이 앱의 원칙이에요.
          </p>
        </div>

        <div>
          <label className={labelCls}>
            내 상황·프로필 <span className="font-normal text-zinc-400">(선택)</span>
          </label>
          <input
            className={fieldCls}
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            placeholder="예: 학과/거주지/학년 등 (결과 화면에서 넘어오면 자동으로 채워져요)"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
            {error}
          </div>
        )}
        {payError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{payError}</div>
        )}

        {needPay ? (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <p className="mb-1 text-sm font-semibold text-zinc-800">무료 1회를 모두 사용했어요</p>
            <p className="mb-3 text-xs text-zinc-500">
              이용권을 구매하면 계속 쓸 수 있어요. 회원가입 없이 결제 후 받는 코드로 바로 사용돼요.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(gate?.packs ?? {}).map(([id, p]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => buyPack(id)}
                  className="rounded-lg bg-brand px-3 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong"
                >
                  {p.credits}건 · {p.amount.toLocaleString()}원
                </button>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm uppercase"
                placeholder="이미 받은 이용권 코드 (JF-…)"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
              />
              <button
                type="button"
                onClick={applyCode}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50"
              >
                적용
              </button>
            </div>
          </div>
        ) : (
          <>
            {gate?.enabled && (
              <p className="text-center text-xs text-zinc-500">
                {creditCode && (remaining ?? 0) > 0
                  ? `🎫 이용권 ${remaining}건 남음`
                  : !gate.freeUsed
                    ? "✨ 첫 1회는 무료로 써볼 수 있어요"
                    : null}
              </p>
            )}
            <button
              type="button"
              onClick={generate}
              disabled={loading}
              className="w-full rounded-xl bg-gradient-to-r from-brand to-brand-strong py-3.5 text-base font-bold text-white shadow-brand transition-all hover:brightness-105 active:scale-[.99] disabled:opacity-60 disabled:active:scale-100"
            >
              {loading ? "초안을 쓰고 다듬는 중… (10~30초)" : "초안 만들기"}
            </button>
          </>
        )}
      </div>

      {(output || loading) && (
        <div className="mt-6 rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-card animate-fade-up">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-zinc-700">
              초안 <span className="font-normal text-zinc-400">({output.length}자)</span>
            </span>
            {output && (
              <button
                type="button"
                onClick={copyOut}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
              >
                {copied ? "복사됨 ✓" : "복사"}
              </button>
            )}
          </div>
          {!output && loading ? (
            <p className="text-sm text-zinc-400">
              1차 초안을 쓰고, 더 자연스럽게 다듬고 있어요…
              <span className="ml-0.5 animate-pulse text-blue-400">▍</span>
            </p>
          ) : (
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-zinc-800">
              {output}
              {loading && <span className="ml-0.5 animate-pulse text-blue-400">▍</span>}
            </p>
          )}
          {output && !loading && (
            <button
              type="button"
              onClick={generate}
              className="mt-4 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
            >
              다시 쓰기
            </button>
          )}
        </div>
      )}

      <p className="mt-4 text-center text-xs text-zinc-400">
        입력 정보는 초안 생성에만 쓰이며 저장되지 않습니다. 생성된 글은 초안이니 반드시 본인 사실로 검토·수정 후 제출하세요.
      </p>
    </main>
  );
}

export default function DraftPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-zinc-400">불러오는 중…</div>}>
      <DraftForm />
    </Suspense>
  );
}
