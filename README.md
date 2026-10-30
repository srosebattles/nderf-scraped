# nderf-scraped

Crawler and parser for the English near-death experience archive at
[nderf.org](https://www.nderf.org/Archives/archivelist.htm), for personal research.

This repo only fetches and structures the data. Analysis lives elsewhere and reads the files in
`data/`.

The code here contains no account text and can be shared. **`data/` is a separate git
repository**, ignored by this one, so the scraped text never ends up in this repo's history.

## Terms

NDERF's user agreement says accounts are jointly copyrighted by NDERF and the people who shared
them, and may be used "exclusively for private, personal, or research use". **Do not publish or
redistribute the account text.** The `data/` repository's remote, if it has one, must be private.

## Usage

Needs Node 22+ (`nvm use` picks up `.nvmrc`).

```bash
npm install
git init data            # first time only: data/ is its own (private) repository
npm run crawl     # download into data/raw/ (resumable; ~1.5–2 hours from scratch)
npm run parse     # data/raw/ -> data/accounts/*.jsonl and data/index_entries.jsonl
npm test
```

Crawl options (after `--`):

- `--delay <ms>`: minimum gap between requests (default 1000).
- `--per-index <n>`: only the first *n* accounts from each index page, for a quick sample.
- `--refresh-indexes`: re-download the index pages and the search-site listing to pick up newly
  posted accounts. Without it, ones already in `data/raw/` are reused. Account pages are never
  re-downloaded.

Set `NDERF_CONTACT` to add contact details to the crawler's User-Agent if you want the site's
operators to be able to reach you.

## Layout

```
src/crawl.js               fetch index pages and account pages into data/raw/
src/parse.js               turn data/raw/ into JSONL, offline
src/lib/                   URL/paths, polite fetcher, index-page, account-page and
                           search-listing code
data/                      separate private git repository, ignored here:
  raw/                     raw HTML (and search-listing JSON) mirror + fetch_log.jsonl
  accounts/*.jsonl         one record per account, one file per archive half-year
  index_entries.jsonl      one record per index-page listing
SCHEMA.md                  field reference and caveats
```

`data/raw/` is the source of truth: the parser can be changed and re-run any number of times
without touching the site.

## What gets crawled

- The 52 half-year archive pages linked from `Archives/archivelist.htm` (1998 onward).
- `Archives/NDERF_NDEs.html`: recent accounts not yet moved to a half-year page.
- `Archives/exceptional.html`: NDERF's list of exceptional accounts.
- Every account page those link to: mostly `www.nderf.org/Experiences/…`, plus a few recent
  ones on the newer `search.nderf.org/experience/…` pages.
- The newer search site's listing, newest first, as far as the site serves it. It returns an
  error after page 49 (about 1,000 accounts, back to late 2021), and the crawler stops there
  rather than trying to get around it. Accounts in that listing that the static archive doesn't
  link to, or links to a dead page, are downloaded too (see SCHEMA.md).

As of the October 2026 crawl, 11 listed account links are dead on NDERF's side (404; switching
`.htm`/`.html` doesn't help). They show up as `404` in `data/raw/fetch_log.jsonl`. Five of them
are recovered from the search site, and a few others are also listed under a different URL,
which is crawled. One page is only a "this page has moved" notice; the account it points to is
crawled too.

Not included: the sister site oberf.org (OBEs, after-death communications, etc. that aren't on
NDERF's index pages) and the non-English archives.
