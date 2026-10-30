#!/usr/bin/env node
// Turns the raw HTML mirror in data/raw/ into structured records, entirely offline.
//
//   data/index_entries.jsonl    one row per entry on an index page (an account can be listed
//                               on several pages, e.g. its half-year page and exceptional.html)
//   data/accounts/<period>.jsonl  one row per account page, with its index listings merged in,
//                               split by the earliest half-year archive page that lists it
//                               (2015-H1.jsonl, …) so no file gets near GitHub's size limits
//
// Accounts that only the search site lists (or whose static page is a dead link) are added
// too, filed by the half-year they were posted, unless their text shows the static archive
// already has them under a differently spelled name.
//
// See SCHEMA.md for the fields. Run after (or during) a crawl: `npm run parse`.
import fs from 'node:fs/promises';
import path from 'node:path';
import { decodeHtml } from './lib/http.js';
import { readFetchLog } from './lib/fetch-log.js';
import { ARCHIVE_LIST_URL, EXCEPTIONAL_URL, allIndexUrls, parseIndexEntries } from './lib/index-page.js';
import { parseExperiencePage } from './lib/experience-page.js';
import { DATA_DIR, rawPathFor, relativeToRoot } from './lib/paths.js';
import { bestContainment, classifySearchEntries, entryUrl, readSavedListing } from './lib/search-listing.js';

// A search-site account whose text is at least this much contained in a static account is
// treated as the same account.
const DUPLICATE_SCORE = 0.5;

const readRaw = (url) => fs.readFile(rawPathFor(url)).then(decodeHtml, () => null);

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

// "2025-05-15" -> "2025-H1"
const halfYear = (date) => (date ? `${date.slice(0, 4)}-H${Number(date.slice(5, 7)) <= 6 ? 1 : 2}` : null);

const fullText = (parts) => parts.map((p) => [p.narrative, ...p.qa.map((q) => q.response)].join('\n')).join('\n');

function buildRecord(url, page, listings, fetched, search = null) {
  const periodListings = listings.filter((l) => l.index_url !== EXCEPTIONAL_URL);
  return {
    id: recordId(url),
    url,
    link_text:
      (periodListings[0] ?? listings[0])?.link_text ??
      `${search.POSTNAME.trim()} ${search.CLASSIFICATION.join('/')}`.trim(),
    // Sorts chronologically: "1998-2001" < "2002-H1" < "2003" < … < "current".
    archive_periods: [...new Set(periodListings.map((l) => l.archive_period))].sort(),
    posted_dates: [
      ...new Set([...listings.flatMap((l) => l.posted_dates), ...(search?.POSTDATE ?? []).map((d) => d.slice(0, 10))]),
    ].sort(),
    exceptional:
      Boolean(search?.EXCEPTIONAL) ||
      listings.some((l) => l.index_url === EXCEPTIONAL_URL) ||
      listings.some((l) => /exceptional/i.test(l.tag ?? '')),
    ...page,
    listings,
    search_listing: search && {
      status: search.status,
      entry_number: Number(search.ENTRYNUM),
      name: search.POSTNAME.trim(),
      classification: search.CLASSIFICATION,
      posted: search.POSTDATE.map((d) => d.slice(0, 10)),
      experienced: (search.EXPDATE ?? []).map((d) => d?.slice(0, 10) ?? null),
    },
    raw_path: relativeToRoot(rawPathFor(url)),
    fetched_at: fetched?.fetched_at ?? null,
    sha256: fetched?.sha256 ?? null,
  };
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
  const stats = { templates: {}, warnings: {}, missing: 0, search: {}, duplicates: [] };
  for (const [url, listings] of [...listingsByUrl].sort(([a], [b]) => a.localeCompare(b))) {
    const html = await readRaw(url);
    if (!html) {
      stats.missing++;
      continue;
    }
    const page = parseExperiencePage(html, url);
    records.push(buildRecord(url, page, listings, fetchLog.get(url)));
    tally(stats.templates, page.template);
    for (const w of page.warnings) tally(stats.warnings, w);
  }

  // Search-site accounts the static archive doesn't link to, or links to dead pages.
  const listing = await readSavedListing();
  const extras = [];
  for (const c of classifySearchEntries(listing, entries, (u) => fetchLog.get(u)?.status === 404)) {
    if (c.status === 'listed') continue;
    const url = entryUrl(c.entry);
    const html = await readRaw(url);
    if (html) extras.push({ ...c, url, page: parseExperiencePage(html, url) });
    else stats.missing++;
  }
  const best = bestContainment(
    extras.map((x) => fullText(x.page.parts)),
    records.map((r) => ({ id: r.id, text: fullText(r.parts) })),
  );
  extras.forEach(({ entry, status, matches, url, page }, i) => {
    if (best[i].score >= DUPLICATE_SCORE) {
      stats.duplicates.push(`${entry.POSTNAME.trim()} (${url}) = ${best[i].id}, ${Math.round(best[i].score * 100)}%`);
      return;
    }
    const listings = matches.map(({ url: _, ...listing }) => listing);
    records.push(buildRecord(url, page, listings, fetchLog.get(url), { ...entry, status }));
    tally(stats.search, status);
    tally(stats.templates, page.template);
    for (const w of page.warnings) tally(stats.warnings, w);
  });

  const shards = Map.groupBy(records, (r) => r.archive_periods[0] ?? halfYear(r.posted_dates[0]) ?? 'unlisted');
  await fs.mkdir(ACCOUNTS_DIR, { recursive: true });
  for (const name of await fs.readdir(ACCOUNTS_DIR)) {
    if (name.endsWith('.jsonl') && !shards.has(name.slice(0, -6))) await fs.rm(path.join(ACCOUNTS_DIR, name));
  }
  for (const [shard, rows] of shards) await writeJsonl(path.join(ACCOUNTS_DIR, `${shard}.jsonl`), rows);

  console.log(`${entries.length} index entries, ${listingsByUrl.size} distinct accounts`);
  console.log(`${records.length} parsed into ${shards.size} files, ${stats.missing} not downloaded yet`);
  console.log(`search site: ${listing.length} listed; added`, stats.search, `skipped as already in the static archive: ${stats.duplicates.length}`);
  for (const d of stats.duplicates) console.log(`  ${d}`);
  console.log('templates:', stats.templates);
  console.log('warnings:', stats.warnings);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
