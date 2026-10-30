#!/usr/bin/env node
// Polite, resumable crawler for the NDERF English NDE archive.
//
// Saves every page's raw bytes under data/raw/ (mirroring the URL path) and never re-fetches
// a page it already has, so it can be stopped and restarted at any time. Index pages are
// also served from data/raw/ unless --refresh-indexes is passed.
//
// After the static archive it reads the search site's listing (as far as the site serves it)
// and downloads accounts the static archive doesn't link to, or links to dead pages.
//
//   npm run crawl                         # everything, one request per second at most
//   npm run crawl -- --per-index 2        # sample: first 2 accounts from each index page
//   npm run crawl -- --refresh-indexes    # re-download index pages to pick up new accounts
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createFetcher, decodeHtml } from './lib/http.js';
import { readFetchLog } from './lib/fetch-log.js';
import { ARCHIVE_LIST_URL, allIndexUrls, parseIndexEntries } from './lib/index-page.js';
import { FETCH_LOG, rawPathFor, relativeToRoot } from './lib/paths.js';
import {
  MAX_LISTING_PAGES,
  classifySearchEntries,
  entryUrl,
  listingPageError,
  listingPath,
  listingUrl,
  readSavedListing,
  removeSavedListingPages,
} from './lib/search-listing.js';

const { values: opts } = parseArgs({
  options: {
    delay: { type: 'string', default: '1000' },
    'per-index': { type: 'string' },
    'refresh-indexes': { type: 'boolean', default: false },
  },
});
const perIndex = opts['per-index'] ? Number(opts['per-index']) : Infinity;
const fetchPage = createFetcher({ delayMs: Number(opts.delay) });

const exists = (file) => fs.access(file).then(() => true, () => false);
const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

// Fetches a URL and stores the body under data/raw/; returns the body, or null on failure.
// `validate(body)` can reject a successful response by returning an error message.
async function download(url, file = rawPathFor(url), validate = () => null) {
  const res = await fetchPage(url);
  const problem = res.ok ? validate(res.body) : null;
  const saved = res.ok && !problem;
  const entry = {
    url,
    final_url: res.finalUrl ?? null,
    status: res.status,
    error: res.error ?? problem ?? null,
    bytes: res.body?.length ?? 0,
    sha256: res.body ? createHash('sha256').update(res.body).digest('hex') : null,
    fetched_at: new Date().toISOString(),
    path: saved ? relativeToRoot(file) : null,
  };
  if (saved) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.part`;
    await fs.writeFile(tmp, res.body);
    await fs.rename(tmp, file);
  }
  await fs.mkdir(path.dirname(FETCH_LOG), { recursive: true });
  await fs.appendFile(FETCH_LOG, JSON.stringify(entry) + '\n');
  return saved ? res.body : null;
}

async function getIndexPage(url) {
  const file = rawPathFor(url);
  const body =
    !opts['refresh-indexes'] && (await exists(file)) ? await fs.readFile(file) : await download(url);
  if (!body) log(`index page failed: ${url}`);
  return body ? decodeHtml(body) : null;
}

// Saved pages are reused unless --refresh-indexes is passed; either way the next page is tried,
// and the first error marks the end of what the site serves.
async function getSearchListing() {
  let page = 0;
  for (; page < MAX_LISTING_PAGES; page++) {
    const file = listingPath(page);
    if (!opts['refresh-indexes'] && (await exists(file))) continue;
    if (!(await download(listingUrl(page), file, listingPageError))) break;
  }
  if (opts['refresh-indexes']) await removeSavedListingPages(page);
  return readSavedListing();
}

async function fetchMissing(urls, label) {
  let fetched = 0;
  let cached = 0;
  let failed = 0;
  for (const url of urls) {
    if (await exists(rawPathFor(url))) {
      cached++;
      continue;
    }
    if (await download(url)) fetched++;
    else {
      failed++;
      log(`failed: ${url}`);
    }
    if ((fetched + failed) % 100 === 0) {
      log(`${label}: ${fetched} fetched, ${failed} failed, ${cached} already had, of ${urls.size}`);
    }
  }
  log(`${label} done: ${fetched} fetched, ${failed} failed, ${cached} already had, of ${urls.size}`);
}

async function main() {
  const archiveList = await getIndexPage(ARCHIVE_LIST_URL);
  if (!archiveList) throw new Error('could not load the archive list');
  const indexUrls = allIndexUrls(archiveList);

  const indexEntries = [];
  const experienceUrls = new Set();
  for (const indexUrl of indexUrls) {
    const html = await getIndexPage(indexUrl);
    if (!html) continue;
    const entries = parseIndexEntries(html, indexUrl);
    indexEntries.push(...entries);
    for (const e of entries.slice(0, perIndex)) experienceUrls.add(e.url);
  }
  log(`${indexUrls.length} index pages list ${experienceUrls.size} distinct experience pages`);
  await fetchMissing(experienceUrls, 'static archive');

  const listing = await getSearchListing();
  const fetchLog = await readFetchLog();
  const extras = classifySearchEntries(listing, indexEntries, (url) => fetchLog.get(url)?.status === 404)
    .filter((c) => c.status !== 'listed')
    .map((c) => entryUrl(c.entry));
  log(`search site lists ${listing.length} accounts; ${extras.length} aren't covered by the static archive`);
  await fetchMissing(new Set(extras), 'search site');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
