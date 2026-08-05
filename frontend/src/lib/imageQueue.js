/**
 * A global, concurrency-limited image preloader.
 *
 * WHY THIS EXISTS — OtakuGIFs' CDN (cdn.otakugifs.xyz) has bot/abuse
 * protection that rejects rapid concurrent requests with **HTTP 428**. Measured
 * against the live CDN:
 *
 *     2 parallel requests → 12/12 succeed
 *     3 parallel requests →  8/12 succeed  (4 × 428)
 *    12 parallel requests →  1/12 succeeds (11 × 428, all failing in ~10ms)
 *
 * That instant-failure signature is what made the GIF grid render as empty
 * boxes: not slow images, not broken urls, not file size — the CDN was simply
 * refusing them. A browser fires all <img> tags in a grid at once, so the
 * grid could never work without pacing.
 *
 * So images are loaded through this queue instead of being handed straight to
 * the DOM: at most MAX_IN_FLIGHT at a time, with a small gap between starts
 * and a backoff retry for the ones that still get refused. Once an image is
 * decoded it lives in the browser's HTTP cache, so the <img> that finally
 * renders it resolves instantly and never re-hits the CDN.
 */

const MAX_IN_FLIGHT = 2;   // measured ceiling — 3 starts getting 428s
const GAP_MS = 120;        // small stagger between starts
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 600;

let inFlight = 0;
const queue = [];
// url → Promise<boolean>, so two tiles asking for the same image share one load
// and a re-render never re-queues work that already finished.
const cache = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pump() {
  while (inFlight < MAX_IN_FLIGHT && queue.length) {
    const job = queue.shift();
    inFlight++;
    job();
  }
}

/** Resolve once `url` is decoded (true) or definitively failed (false). */
function loadOnce(url) {
  return new Promise((resolve) => {
    const img = new Image();
    // Never send credentials/Referer games — plain GET, same as an <img>.
    img.decoding = "async";
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

/**
 * Queue `url` for loading. Returns a promise resolving true when the image is
 * in cache and safe to render, false if it could not be loaded.
 */
export function preloadImage(url) {
  if (!url) return Promise.resolve(false);
  if (cache.has(url)) return cache.get(url);

  const p = new Promise((resolve) => {
    queue.push(async () => {
      let ok = false;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
        ok = await loadOnce(url);
        // A refusal (428) and a genuine 404 are indistinguishable from an
        // <img> error, so retry a couple of times with backoff — a real 404
        // just fails three cheap times.
        if (!ok && attempt < MAX_ATTEMPTS) await sleep(RETRY_BASE_MS * attempt);
      }
      await sleep(GAP_MS);
      inFlight--;
      resolve(ok);
      pump();
    });
    pump();
  });

  cache.set(url, p);
  return p;
}

/** Drop cached results (used by the shuffle button so retries can happen). */
export function clearImageQueueCache() {
  cache.clear();
}
