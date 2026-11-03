import type { MetadataRoute } from "next";

/**
 * No crawler has any business here.
 *
 * `noindex` headers and meta tags already stop indexing; this stops *crawling*,
 * which keeps the login page and any future public path out of crawl logs and
 * link graphs entirely. There is deliberately no sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
