import type { MetadataRoute } from "next";

const baseUrl = "https://routelapse.com";

// Only the homepage is public, indexable content today. /trip/[id] editor pages
// are per-user and excluded (see robots.ts). Add landing/guide routes here as
// they ship (e.g. /mult-dev-alternative, /how-to-make-a-travel-map-video).
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
