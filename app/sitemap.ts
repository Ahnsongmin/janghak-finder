import type { MetadataRoute } from "next";
import { getBenefits } from "@/lib/store";

const BASE = "https://janghak-finder.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const statics: MetadataRoute.Sitemap = [
    { url: BASE, changeFrequency: "daily", priority: 1 },
    { url: `${BASE}/draft`, changeFrequency: "weekly", priority: 0.8 },
  ];
  // 상세 페이지 전부 (1만 건 미만 — 사이트맵 1개 한도 5만 이내)
  const details: MetadataRoute.Sitemap = getBenefits().map((b) => ({
    url: `${BASE}/s/${encodeURIComponent(b.id)}`,
    lastModified: b.lastFetchedAt ? new Date(b.lastFetchedAt) : undefined,
    changeFrequency: "weekly",
    priority: 0.6,
  }));
  return [...statics, ...details];
}
