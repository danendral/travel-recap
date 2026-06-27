import type { MetadataRoute } from "next";

// Only the landing page (/) is public, indexable content. /trip/[id] is a
// per-trip editor backed by client state — nothing for crawlers to index, and
// the ids are not shareable public URLs, so disallow that subtree.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/trip/",
    },
    sitemap: "https://routelapse.com/sitemap.xml",
    host: "https://routelapse.com",
  };
}
