/*
 * TradeWizard Operations — service worker.
 *
 * The portal is an internal control surface, so this worker does the minimum a
 * PWA needs and nothing more:
 *
 *   - Static, content-hashed build assets are served stale-while-revalidate.
 *   - Navigations are network-only. If the network is gone, the user gets an
 *     offline notice — never a cached page, which could show a stale shell or a
 *     previous operator's session on a shared machine.
 *   - Everything carrying live or private data is never intercepted: the admin
 *     API (a different origin), S3 presigned payloads, and React Server
 *     Component payloads (`RSC` header / `?_rsc=`), which is how App Router
 *     navigations fetch live data.
 *
 * Bumping VERSION drops every previous cache on activate. Keep it in sync with
 * changes to the caching rules.
 */

const VERSION = "tw-admin-v1";
const STATIC_CACHE = `${VERSION}-static`;

const MAX_STATIC_ENTRIES = 80;

const OFFLINE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Offline · TradeWizard Operations</title>
<style>
  :root { color-scheme: dark; }
  html, body { height: 100%; }
  body {
    margin: 0; display: grid; place-items: center; padding: 24px;
    background: #0e1116; color: #f3f5f9;
    font: 13px/1.55 Ubuntu, -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  }
  .card { max-width: 380px; border: 1px solid #282b30; border-radius: 12px; background: #111419; padding: 24px; }
  .mark { margin-bottom: 20px; }
  h1 { margin: 0; font-size: 19px; font-weight: 500; letter-spacing: -0.012em; }
  p { margin: 8px 0 0; color: #a9aeb5; }
  .note { margin-top: 16px; padding-top: 12px; border-top: 1px solid #262a31; color: #767b82; font-size: 11px; }
  button {
    margin-top: 20px; height: 36px; padding: 0 14px; border: 0; border-radius: 7px;
    background: #3480fc; color: #fff; font: inherit; font-weight: 500; cursor: pointer;
  }
</style>
</head>
<body>
  <div class="card">
    <svg class="mark" width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="0.75" y="0.75" width="22.5" height="22.5" rx="5" stroke="#43484f"/>
      <rect x="5.6" y="6.4" width="12.8" height="2.6" rx="1.3" fill="#3480fc"/>
      <rect x="5.6" y="10.9" width="12.8" height="2.6" rx="1.3" fill="#43484f"/>
      <rect x="5.6" y="15.4" width="8.2" height="2.6" rx="1.3" fill="#43484f"/>
    </svg>
    <h1>You're offline</h1>
    <p>The operations portal needs a connection to load accounts, analyses and trading data.</p>
    <p class="note">Admin pages and API responses are never stored on this device.</p>
    <button type="button" onclick="location.reload()">Try again</button>
  </div>
</body>
</html>`;

self.addEventListener("install", (event) => {
  // No precache list: assets are content-hashed and fetched on demand. Taking
  // over immediately keeps the offline path available from the first load.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

/** Only immutable, non-sensitive files are eligible for caching. */
function isStaticAsset(pathname) {
  if (pathname.startsWith("/_next/static/")) return true;
  if (pathname.startsWith("/icons/")) return true;

  return /^\/(icon\.svg|favicon\.ico|apple-icon\.png|manifest\.webmanifest)$/.test(pathname);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // App Router data fetches carry live records; never cache or replay them.
  if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkOnlyNavigation(request));
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function networkOnlyNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    return new Response(OFFLINE_HTML, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then(async (response) => {
      if (response.ok && response.type === "basic") {
        try {
          await cache.put(request, response.clone());
        } catch {
          // Quota or private-mode refusal: serve the response uncached.
        }
        void trim(cache).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  return cached ?? (await network) ?? Response.error();
}

/** Hashed filenames are stable, but deploys accumulate entries; cap the cache. */
async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_STATIC_ENTRIES) return;

  await Promise.all(
    keys.slice(0, keys.length - MAX_STATIC_ENTRIES).map((key) => cache.delete(key))
  );
}
