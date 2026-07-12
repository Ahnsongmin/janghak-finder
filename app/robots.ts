import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/draft/success"] },
    sitemap: "https://janghak-finder.vercel.app/sitemap.xml",
  };
}
