const RETRIES = 3;
const TIMEOUT_MS = 30_000;

// Set NDERF_CONTACT to add a way for the site's operators to reach you.
const USER_AGENT = `nderf-scraped/0.1 (personal research crawler${
  process.env.NDERF_CONTACT ? `; contact: ${process.env.NDERF_CONTACT}` : ''
})`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const backoff = (attempt) => 5_000 * 3 ** attempt;

// Returns a fetch function that waits at least `delayMs` between requests and retries
// network errors, 429s and 5xx responses with exponential backoff.
export function createFetcher({ delayMs }) {
  let lastRequestAt = 0;

  return async function politeFetch(url) {
    for (let attempt = 0; ; attempt++) {
      const wait = lastRequestAt + delayMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastRequestAt = Date.now();

      let res;
      try {
        res = await fetch(url, {
          headers: { 'user-agent': USER_AGENT },
          redirect: 'follow',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        if (attempt < RETRIES) {
          await sleep(backoff(attempt));
          continue;
        }
        return { url, ok: false, status: 0, error: String(err.cause?.code ?? err.message) };
      }

      if ((res.status === 429 || res.status >= 500) && attempt < RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await res.body?.cancel();
        await sleep(retryAfter > 0 ? retryAfter * 1000 : backoff(attempt));
        continue;
      }

      return {
        url,
        finalUrl: res.url,
        ok: res.ok,
        status: res.status,
        contentType: res.headers.get('content-type'),
        body: Buffer.from(await res.arrayBuffer()),
      };
    }
  };
}

// Raw bytes are stored untouched; decoding happens here, using the page's declared charset.
export function decodeHtml(buf) {
  const head = buf.subarray(0, 4096).toString('latin1');
  const label = head.match(/<meta[^>]+charset=["']?\s*([\w-]+)/i)?.[1]?.toLowerCase() ?? 'utf-8';
  try {
    return new TextDecoder(label).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}
