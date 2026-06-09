"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DRAFT_TONES, type DraftTone } from "@/lib/draft-prompt";

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
        }),
      });

      if (res.status === 503) {
        const j = await res.json();
        setError(`⚠️ ${j.message}`);
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

  const labelCls = "block text-sm font-medium text-zinc-700 mb-1.5";
  const fieldCls =
    "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-zinc-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-zinc-900">✍️ AI 지원서 초안 쓰기</h1>
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ← 홈
        </Link>
      </div>

      <p className="mb-6 text-sm text-zinc-500">
        양식이 묻는 질문과 키워드 몇 개만 적으면, <strong className="text-zinc-700">사람이 쓴 듯 담백한 초안</strong>을
        만들어 드려요. 초안을 쓴 뒤 한 번 더 다듬는 2단계 방식이라 결과가 더 자연스러워요. 키워드 밖의 사실은 지어내지
        않아요. 생성된 글은 초안이니 꼭 본인 사실로 검토·수정 후 제출하세요.
      </p>

      <div className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
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

        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="w-full rounded-xl bg-blue-600 py-3.5 text-base font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
        >
          {loading ? "초안을 쓰고 다듬는 중… (10~30초)" : "초안 만들기"}
        </button>
      </div>

      {(output || loading) && (
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
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
