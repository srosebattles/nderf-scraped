# Data schema

Everything here is produced by `npm run parse` from the raw HTML in `data/raw/`. Values are kept
as NDERF wrote them (case, punctuation and spelling untouched); nothing is interpreted or
normalised beyond whitespace. Derived fields say so.

## `data/accounts/<period>.jsonl`

One JSON object per line, one line per account page. Files are named after the earliest
half-year archive page that lists the account (`2015-H1`, `2003`, `1998-2001`, `current` for the
not-yet-archived page). To read everything, read every file in the folder.

| Field | Type | Notes |
|---|---|---|
| `id` | string | File name of the page without extension (`1jane_d_nde`), or `search-<n>` for search-app pages. |
| `url` | string | Canonical page URL (always `https://www.nderf.org/...` or `https://search.nderf.org/...`). |
| `link_text` | string | The link text on the index page, e.g. `Jane D NDE`. Usually ends in NDERF's classification. |
| `archive_periods` | string[] | Every half-year archive page that lists the account, sorted chronologically. |
| `posted_dates` | string[] | ISO dates from the index listings, sorted. Usually one; reposted accounts have several. This is when NDERF **posted** it, not when it happened or was submitted. |
| `exceptional` | boolean | Listed on `exceptional.html`, or tagged "Exceptional Experience" on an index page. |
| `template` | `"static"` \| `"search-app"` | Which page layout it was parsed from (see below). |
| `page_header` | string \| null | Last breadcrumb on the page, e.g. `1234 Jane D NDE 5678` (running number, name, NDERF number). |
| `page_classification` | string \| null | NDERF's classification from the page itself, raw: `NDE`, `Probable NDE`, `STE`, `NDE-like;SOBE`, … |
| `greyson_score` | number \| null | Greyson NDE Scale score. Only search-app pages show it. |
| `quick_facts` | object \| null | Search-app pages only: `Country`, `Gender`, `Age`, `Date Experienced`, `Date Submitted`. |
| `parts` | Part[] | One per submission on the page. Almost always one; see below. |
| `warnings` | string[] | Parser notes: `no narrative`, `no questionnaire`, `unlabeled text outside the description`, `contains U+FFFD (bad character encoding)`. |
| `listings` | Listing[] | Every index-page entry for this account (same fields as `index_entries.jsonl`, minus `url`). |
| `raw_path` | string | Where the raw HTML lives locally. |
| `fetched_at` | string \| null | ISO timestamp of the download. |
| `sha256` | string \| null | Hash of the raw bytes. |

### Part

Some pages hold more than one submission from the same person: a retelling, a follow-up, or
the same account in two versions. Each starts with its own "Experience Description" heading.
**Decide how to handle these before counting things**, or the same experience can be counted
twice.

| Field | Type | Notes |
|---|---|---|
| `heading` | string \| null | e.g. `Experience Description 12345`, or `Describe the Experience` on some pages. Some end in a date instead of a number. |
| `submission_number` | number \| null | The number at the end of the heading, when there is one. |
| `narrative` | string | The free-text account. Paragraphs separated by `\n`. |
| `background` | object | Labelled fields from "Background Information", keyed by the label without its colon: usually `Gender` and `Date NDE Occurred` or `Date of NDE` (the wording varies by era). Date values are raw text in many formats (`10/1990`, `Spring 1977`, `09/00/2013`). |
| `qa` | QA[] | The questionnaire, in page order. Empty for pages that are only a story. |
| `other_text` | {section, text}[] | Text under a heading that isn't attached to any question. Rare. |

### QA

| Field | Type | Notes |
|---|---|---|
| `section` | string \| null | Heading the question sits under, e.g. `NDE Elements`, `God, Spiritual and Religion`, `After the NDE`. On the few pages with no questionnaire headings this is the description heading, or `Background Information`. |
| `question` | string | Exact question wording from the page. **The questionnaire changed over the years**, so the same idea can be asked in different words, and some questions only exist in some eras. |
| `response` | string | Everything after the question up to the next question or heading. This is the faithful field. |
| `answer` | string \| null | *Derived, heuristic.* The leading multiple-choice part of `response` (`Yes`, `No`, `Uncertain`, `Incredibly more vivid`, …), split off at the first run of spaces or line break. `null` when that leading part is over 80 characters, which means it's free text. |
| `comment` | string \| null | *Derived, heuristic.* The rest of `response` after `answer`. Where the person explains or names who they saw, it is usually here. |

## `data/index_entries.jsonl`

One line per entry on an index page. An account listed on two pages (for example its half-year
page and `exceptional.html`) has two lines.

| Field | Type | Notes |
|---|---|---|
| `index_url` | string | The index page. |
| `archive_period` | string \| null | Period of that page (`2015-H1`, …); `null` for `exceptional.html`. |
| `url` | string | Canonical account URL. |
| `link_text` | string | |
| `seq` | number \| null | NDERF's running number shown before the entry. |
| `posted_raw` | string \| null | Raw date text, e.g. `6/25/2024` or `10/26/2026 & 12/22/2019`. |
| `posted_dates` | string[] | ISO dates parsed from `posted_raw`. |
| `type_label` | string \| null | Classification from the listing, e.g. `NDE`, `Secondhand NDE`. |
| `nderf_numbers` | number[] | Number(s) after the classification. Newer accounts can have two (`30001/7001`). |
| `tag` | string \| null | Usually a country (`From Canada`) or a flag (`Exceptional Experience`). |
| `editor_summary` | string \| null | NDERF's one-line summary of the account. |

## Things to keep in mind when analysing

- **The archive holds more than NDEs.** Index pages also list after-death communications (ADC),
  spiritually transformative experiences (STE), pre-birth memories, dreams and more. Filter on
  `page_classification` or `link_text`.
- **Dates.** There are three different dates: when the experience happened (`background`, free
  text), when it was submitted (only `quick_facts["Date Submitted"]` on search-app pages), and
  when NDERF posted it (`posted_dates`). For older pages, posting date is the nearest available
  stand-in for submission date.
- **Dates can contain typos.** One listing is posted "11/21/1009". Values are kept as written.
- **NDERF edits accounts.** The public versions are "lightly edited for clarity".
- **Answer/comment split is a heuristic.** If it matters, re-split from `response`.
