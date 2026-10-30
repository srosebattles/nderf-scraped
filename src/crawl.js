#!/usr/bin/env node
// Polite, resumable crawler for the NDERF English NDE archive.
//
// Saves every page's raw bytes under data/raw/ (mirroring the URL path) and never re-fetches
// a page it already has, so it can be stopped and restarted at any time. Index pages are
// also served from data/raw/ unless --refresh-indexes is passed.
//
//   npm run crawl                         # everything, one request per second at most
//   npm run crawl -- --per-index 2        # sample: first 2 accounts from each index page
//   npm run crawl -- --refresh-indexes    # re-download index pages to pick up new accounts
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createFetcher, decodeHtml } from './lib/http.js';
import { ARCHIVE_LIST_URL, allIndexUrls, parseIndexEntries } from './lib/index-page.js';
import { FETCH_LOG, rawPathFor, relativeToRoot } from './lib/paths.js';

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
async function download(url) {
  const res = await fetchPage(url);
  const file = rawPathFor(url);
  const entry = {
    url,
    final_url: res.finalUrl ?? null,
    status: res.status,
    error: res.error ?? null,
    bytes: res.body?.length ?? 0,
    sha256: res.body ? createHash('sha256').update(res.body).digest('hex') : null,
    fetched_at: new Date().toISOString(),
    path: res.ok ? relativeToRoot(file) : null,
  };
  if (res.ok) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.part`;
    await fs.writeFile(tmp, res.body);
    await fs.rename(tmp, file);
  }
  await fs.mkdir(path.dirname(FETCH_LOG), { recursive: true });
  await fs.appendFile(FETCH_LOG, JSON.stringify(entry) + '\n');
  return res.ok ? res.body : null;
}

async function getIndexPage(url) {
  const file = rawPathFor(url);
  const body =
    !opts['refresh-indexes'] && (await exists(file)) ? await fs.readFile(file) : await download(url);
  if (!body) log(`index page failed: ${url}`);
  return body ? decodeHtml(body) : null;
}

async function main() {
  const archiveList = await getIndexPage(ARCHIVE_LIST_URL);
  if (!archiveList) throw new Error('could not load the archive list');
  const indexUrls = allIndexUrls(archiveList);

  const experienceUrls = new Set();
  for (const indexUrl of indexUrls) {
    const html = await getIndexPage(indexUrl);
    if (!html) continue;
    const entries = parseIndexEntries(html, indexUrl).slice(0, perIndex);
    for (const e of entries) experienceUrls.add(e.url);
  }
  log(`${indexUrls.length} index pages list ${experienceUrls.size} distinct experience pages`);

  let fetched = 0;
  let cached = 0;
  let failed = 0;
  for (const url of experienceUrls) {
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
      log(`progress: ${fetched} fetched, ${failed} failed, ${cached} already had, of ${experienceUrls.size}`);
    }
  }
  log(`done: ${fetched} fetched, ${failed} failed, ${cached} already had, of ${experienceUrls.size}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
