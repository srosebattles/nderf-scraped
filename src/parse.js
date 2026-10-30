#!/usr/bin/env node
// Turns the raw HTML mirror in data/raw/ into structured records, entirely offline.
//
//   data/index_entries.jsonl    one row per entry on an index page (an account can be listed
//                               on several pages, e.g. its half-year page and exceptional.html)
//   data/accounts/<period>.jsonl  one row per account page, with its index listings merged in,
//                               split by the earliest half-year archive page that lists it
//                               (2015-H1.jsonl, …) so no file gets near GitHub's size limits
//
// See SCHEMA.md for the fields. Run after (or during) a crawl: `npm run parse`.
import fs from 'node:fs/promises';
import path from 'node:path';
import { decodeHtml } from './lib/http.js';
import { ARCHIVE_LIST_URL, EXCEPTIONAL_URL, allIndexUrls, parseIndexEntries } from './lib/index-page.js';
import { parseExperiencePage } from './lib/experience-page.js';
import { DATA_DIR, FETCH_LOG, rawPathFor, relativeToRoot } from './lib/paths.js';

const readRaw = (url) => fs.readFile(rawPathFor(url)).then(decodeHtml, () => null);

async function readFetchLog() {
  const latest = new Map();
  const text = await fs.readFile(FETCH_LOG, 'utf8').catch(() => '');
  for (const line of text.split('\n')) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // blank, or a line the crawler is still writing
    }
    if (entry.path) latest.set(entry.url, entry);
  }
  return latest;
}

function recordId(url) {
  const u = new URL(url);
  if (u.hostname === 'search.nderf.org') return `search-${u.pathname.match(/\d+/)[0]}`;
  return path.basename(u.pathname).replace(/\.html?$/i, '');
}

const ACCOUNTS_DIR = path.join(DATA_DIR, 'accounts');

async function writeJsonl(file, rows) {
  const tmp = `${file}.part`;
  await fs.writeFile(tmp, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  await fs.rename(tmp, file);
}

function tally(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

async function main() {
  const archiveList = await readRaw(ARCHIVE_LIST_URL);
  if (!archiveList) throw new Error('no archive list in data/raw/ yet; run `npm run crawl` first');

  const entries = [];
  for (const indexUrl of allIndexUrls(archiveList)) {
    const html = await readRaw(indexUrl);
    if (html) entries.push(...parseIndexEntries(html, indexUrl));
    else console.warn(`missing index page: ${indexUrl}`);
  }
  await writeJsonl(path.join(DATA_DIR, 'index_entries.jsonl'), entries);

  const listingsByUrl = new Map();
  for (const { url, ...listing } of entries) {
    if (!listingsByUrl.has(url)) listingsByUrl.set(url, []);
    listingsByUrl.get(url).push(listing);
  }

  const fetchLog = await readFetchLog();
  const records = [];
  const stats = { templates: {}, warnings: {}, missing: 0 };
  for (const [url, listings] of [...listingsByUrl].sort(([a], [b]) => a.localeCompare(b))) {
    const html = await readRaw(url);
    if (!html) {
      stats.missing++;
      continue;
    }
    const page = parseExperiencePage(html, url);
    const periodListings = listings.filter((l) => l.index_url !== EXCEPTIONAL_URL);
    const fetched = fetchLog.get(url);
    records.push({
      id: recordId(url),
      url,
      link_text: (periodListings[0] ?? listings[0]).link_text,
      // Sorts chronologically: "1998-2001" < "2002-H1" < "2003" < … < "current".
      archive_periods: [...new Set(periodListings.map((l) => l.archive_period))].sort(),
      posted_dates: [...new Set(listings.flatMap((l) => l.posted_dates))].sort(),
      exceptional:
        listings.some((l) => l.index_url === EXCEPTIONAL_URL) ||
        listings.some((l) => /exceptional/i.test(l.tag ?? '')),
      ...page,
      listings,
      raw_path: relativeToRoot(rawPathFor(url)),
      fetched_at: fetched?.fetched_at ?? null,
      sha256: fetched?.sha256 ?? null,
    });
    tally(stats.templates, page.template);
    for (const w of page.warnings) tally(stats.warnings, w);
  }
  const shards = Map.groupBy(records, (r) => r.archive_periods[0] ?? 'unlisted');
  await fs.mkdir(ACCOUNTS_DIR, { recursive: true });
  for (const name of await fs.readdir(ACCOUNTS_DIR)) {
    if (name.endsWith('.jsonl') && !shards.has(name.slice(0, -6))) await fs.rm(path.join(ACCOUNTS_DIR, name));
  }
  for (const [shard, rows] of shards) await writeJsonl(path.join(ACCOUNTS_DIR, `${shard}.jsonl`), rows);

  console.log(`${entries.length} index entries, ${listingsByUrl.size} distinct accounts`);
  console.log(`${records.length} parsed into ${shards.size} files, ${stats.missing} not downloaded yet`);
  console.log('templates:', stats.templates);
  console.log('warnings:', stats.warnings);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
