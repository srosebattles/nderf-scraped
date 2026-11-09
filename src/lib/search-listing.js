import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalUrl, RAW_DIR } from './paths.js';

// NDERF's newer search site (search.nderf.org) lists accounts newest first, 20 to a page, from
// a JSON endpoint. It only serves the first ~49 pages (about 1,000 accounts, back to late 2021)
// and answers later pages with {"error": …}, so the listing is read until the first error and
// no further. A few accounts there have no page in the static archive; this module finds them.

export const MAX_LISTING_PAGES = 200; // safety stop; the site errors long before this

export function listingUrl(page) {
  const query = Buffer.from(`sort=POSTDATE&lang=en&page=${page}`).toString('base64');
  return `https://search.nderf.org/api/get?e=${encodeURIComponent(query)}`;
}

const LISTING_DIR = path.join(RAW_DIR, 'search.nderf.org', 'api', 'listing');
export const listingPath = (page) => path.join(LISTING_DIR, `page-${String(page).padStart(3, '0')}.json`);

// Returns an error message if a response body isn't a usable listing page, otherwise null.
export function listingPageError(body) {
  try {
    const data = JSON.parse(body);
    return Array.isArray(data.results) && data.results.length ? null : String(data.error ?? 'no results');
  } catch {
    return 'not JSON';
  }
}

// Reads the listing pages saved under data/raw/, in order, stopping at the first missing one.
export async function readSavedListing() {
  const entries = [];
  for (let page = 0; page < MAX_LISTING_PAGES; page++) {
    const body = await fs.readFile(listingPath(page), 'utf8').catch(() => null);
    if (!body) break;
    entries.push(...JSON.parse(body).results);
  }
  return entries;
}

// Deletes saved pages from `fromPage` on (after a refresh that returned fewer pages).
export async function removeSavedListingPages(fromPage) {
  for (let page = fromPage; page < MAX_LISTING_PAGES; page++) {
    await fs.rm(listingPath(page), { force: true });
  }
}

export const entryUrl = (entry) => canonicalUrl(entry.URL || `/experience/${entry.ENTRYNUM}`, 'https://search.nderf.org');

// Classification words that end names on both sites ("Example X Probable NDE").
const TYPE_WORDS =
  /\b(nde|ndes|probable|possible|ste|stes|adc|adcs|sobe|sobes|obe|obes|fde|sde|nele|neles|other|others|drug|drugs|pre-?birth|birth|rememberance|remembrance|anesthesia|anestesia|prayer|prayers|dream|like|entity|encounter|orb|shared|secondhand|second-person|life-threatening|event|dbv|ufo|premonition|meditation|experiences?|exceptional|and|vs)\b/g;

// A comparable form of a name: "Example X. Probable NDE" -> "example x". Non-Latin names on the
// search site carry a transliteration ("Алексей (Aleksey)"), which is used instead.
export function nameKey(name) {
  let s = name ?? '';
  if (/[^\u0000-ɏ]/.test(s) && /\(.+?\)/.test(s)) s = s.match(/\((.+?)\)/)[1];
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(TYPE_WORDS, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DAY_MS = 864e5;
const numbersInUrl = (url) => (url.match(/[_/](\d{3,})(?:\.html?)?\/?$/) || []).slice(1).map(Number);

function pushTo(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

// Compares each search-listing entry with the static archive's index entries:
//   listed   - the static archive lists it (same number, or same name posted within a year)
//   dead     - it matches static entries, but every one of their pages is a dead link
//   unlisted - nothing in the static archive matches
// `isDead(url)` says whether a static account page could not be downloaded.
export function classifySearchEntries(searchEntries, indexEntries, isDead) {
  const byNumber = new Map();
  const byName = new Map();
  for (const e of indexEntries) {
    for (const n of new Set([...e.nderf_numbers, ...numbersInUrl(e.url)])) pushTo(byNumber, n, e);
    const key = nameKey(e.link_text);
    if (key) pushTo(byName, key, e);
  }

  return searchEntries.map((entry) => {
    const numbers = [entry.ENTRYNUM, ...(entry.experiences ?? []).map((x) => x.ENTRYNUM)].map(Number);
    const posted = entry.POSTDATE?.[0]?.slice(0, 10);
    let matches = [...new Set(numbers.flatMap((n) => byNumber.get(n) ?? []))];
    const key = nameKey(entry.POSTNAME);
    if (!matches.length && key && posted) {
      matches = (byName.get(key) ?? []).filter((e) =>
        e.posted_dates.some((d) => Math.abs(new Date(d) - new Date(posted)) <= 365 * DAY_MS),
      );
    }
    const status = !matches.length ? 'unlisted' : matches.every((e) => isDead(e.url)) ? 'dead' : 'listed';
    return { entry, status, matches };
  });
}

const SHINGLE_WORDS = 5;

function shingles(text) {
  const words = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  const out = new Set();
  for (let i = 0; i + SHINGLE_WORDS <= words.length; i++) out.add(words.slice(i, i + SHINGLE_WORDS).join(' '));
  return out;
}

// For each candidate text, finds the record containing the largest share of the candidate's
// 5-word sequences. This catches accounts the search site lists under a differently spelled
// name ("Jon" vs "John") that the static archive already has.
// Returns [{ id, score }] in candidate order; score is 0..1.
export function bestContainment(candidateTexts, records) {
  const sets = candidateTexts.map(shingles);
  const owners = new Map();
  sets.forEach((set, i) => {
    for (const s of set) pushTo(owners, s, i);
  });
  const best = sets.map(() => ({ id: null, score: 0 }));
  for (const { id, text } of records) {
    const hits = new Map();
    for (const s of shingles(text)) {
      for (const i of owners.get(s) ?? []) hits.set(i, (hits.get(i) ?? 0) + 1);
    }
    for (const [i, n] of hits) {
      const score = n / sets[i].size;
      if (score > best[i].score) best[i] = { id, score };
    }
  }
  return best;
}
