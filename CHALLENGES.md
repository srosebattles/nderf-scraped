# Scraping challenges

Notes on what made the NDERF archive harder to scrape than it looks, and how this repo deals
with each problem. Numbers are from the October 2026 crawl.

## Terms and privacy

- **The text can't be redistributed.** Accounts are jointly copyrighted by NDERF and the people
  who shared them, and may be used only for private, personal or research purposes. So the code
  is public and the data lives in a separate private repository that this one ignores.
- **No real examples in the code.** Tests use made-up HTML, and comments and docs use made-up
  names. That takes some discipline: real listing titles are the most natural examples to reach
  for while debugging.

## Finding everything

- **The obvious index is incomplete.** The main archive page only links up to 2019. A different
  page, `archivelist.htm`, has all 52 half-year pages through 2026.
- **Not every account is on a half-year page.** Recent ones sit on a separate "current" page,
  NDERF's picks are on an "exceptional" list, and at least one account page isn't linked from
  any index at all.
- **Newer accounts live on a second site** (search.nderf.org) with a different layout, a
  different numbering scheme, and an account list that only JavaScript loads.
- **That site only serves about 1,000 results** (49 pages, back to late 2021) and returns an
  error after that. The crawler stops at the first error rather than working around the limit.
  Accounts from before late 2021 can't be checked against it.
- **Links rot.** 11 listed account pages return 404. Five were recovered from the search site;
  one other page is just a "this page has moved" notice.

## Pages that don't agree with each other

- **The page layout changed over 25 years.** The oldest pages are just a story. Later ones mark
  questions with inline colours, newer ones with CSS classes, some with both, and the search
  site uses proper markup. The parser has to recognise all of them.
- **Headings vary**: "Experience Description", "Describe the Experience", headings with a number
  or a date on the end, empty headings, and a few pages that put the whole questionnaire under
  "Background Information".
- **One page can hold several submissions** from the same person, sometimes the same experience
  told twice. These are kept as separate parts so analysis can avoid counting them twice.
- **The questionnaire wording changed** over time, so the parser keeps each question exactly as
  written rather than mapping it to a fixed list.
- **Answers and comments run together.** A multiple-choice answer and the person's comment are one
  string separated only by spaces or a line break. Splitting them is a heuristic, so the full
  response is always kept too.

## Dates

- **Three different dates**: when the experience happened (free text, many formats), when it was
  submitted (only shown on the newest pages), and when NDERF posted it (only on the index pages,
  so the crawler has to record which index page linked to each account).
- **Reposted accounts** have several posting dates, and at least one date is a typo (year 1009).
  Values are kept as written.

## Matching the two sites

- **Numbers don't line up.** The same recent account can be 33xxx on the search site and 13xxx in
  the static archive.
- **Names don't line up either.** The same account can be spelled differently on each site
  ("Jon" vs "John" style), use a non-Latin name with a transliteration on one side only, or even
  appear under a different name entirely.
- **So matching is layered**: first by number, then by name posted within a year, and finally by
  text. An account is treated as a duplicate if at least half of its 5-word sequences appear in
  an account already in the data. Real duplicates scored 73–100%; genuinely new accounts scored
  15% or less.

## Other languages

- **The language archives are mostly translations of English accounts**, not separate
  collections. Scraping them would mostly add duplicates in translation.
- **The French and Spanish archives have disappeared**, and the search site's language versions
  all show the same database.
- **About 14% of the English archive (819 accounts) was translated from other languages**,
  flagged only in free-text tags that are inconsistent ("Farsi" vs "Persian", some with no
  language named).

## Mechanics

- **Raw first, parse later.** Every page is saved as downloaded, and parsing runs offline, so
  fixing the parser never means hitting the site again. The first full run turned up layout
  variations that a sample of 2 pages per index had missed.
- **Polite and resumable.** One request per second; a full crawl of ~5,900 pages took about an
  hour and 40 minutes and can be stopped and restarted at any point.
- **The server is case-sensitive but macOS usually isn't**, so file names with capital letters get
  a short hash to keep them from colliding.
- **Errors don't always look like errors.** The search site answers requests for accounts that
  don't exist with a generic page and status 200, and the old language home pages "redirect"
  with a tag inside the page rather than a real HTTP redirect.
- **Size.** The parsed data is about 120 MB as one file, over GitHub's 100 MB limit, so it is
  split into one file per half-year.
- **Encoding.** A couple of pages contain broken characters from a bad conversion at some point;
  they're flagged rather than guessed at.
