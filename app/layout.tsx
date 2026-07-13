import type { Metadata } from "next";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "장학금·지원금 찾기",
    template: "%s | 장학금·지원금 찾기",
  },
  description:
    "주소·소득분위·대학 등 몇 가지만 입력하면 받을 수 있는 장학금·지원금과 신청 조건, 공식 신청 링크를 모아 보여드립니다.",
};

// 애드센스 자동광고 — NEXT_PUBLIC_ADSENSE_CLIENT(ca-pub-…) 등록 시에만 켜짐
const ADSENSE = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
        {ADSENSE && (
          <script
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE}`}
            crossOrigin="anonymous"
          />
        )}
      </head>
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-20 border-b border-zinc-200/70 bg-white/80 backdrop-blur-xl">
          <div className="mx-auto flex h-16 w-full max-w-2xl items-center justify-between px-5">
            <Link
              href="/"
              className="flex items-center gap-2.5 font-extrabold tracking-tight text-ink"
            >
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-brand to-brand-strong text-[15px] font-black text-white shadow-brand">
                ₩
              </span>
              <span className="text-[17px]">장학금 파인더</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link
                href="/draft"
                className="rounded-full px-3.5 py-2 font-semibold text-ink/70 transition-colors hover:bg-brand-soft hover:text-brand"
              >
                AI 지원서
              </Link>
            </nav>
          </div>
        </header>
        <div className="flex-1">{children}</div>
        <footer className="mt-4 border-t border-zinc-200/70 bg-white/40 py-9 text-center text-xs leading-relaxed text-ink/40">
          정부 공식 공개 데이터 기반 · 모든 결과에 출처와 공식 신청 링크 표기
          <br />
          정확한 조건은 반드시 공식 페이지에서 확인하세요.
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
