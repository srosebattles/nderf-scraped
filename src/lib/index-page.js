import path from 'node:path';
import * as cheerio from 'cheerio';
import { canonicalUrl } from './paths.js';

export const ARCHIVE_LIST_URL = 'https://www.nderf.org/Archives/archivelist.htm';
// Not on the archive list: the current, not-yet-archived half-year, and the "exceptional" list.
export const CURRENT_URL = 'https://www.nderf.org/Archives/NDERF_NDEs.html';
export const EXCEPTIONAL_URL = 'https://www.nderf.org/Archives/exceptional.html';

// Half-year archive pages: 2_1_2015.html (Jan–Jun), 2_6_2015.html (Jul–Dec), split pages
// like 2_6_2010_1.html, plus 2_2003.html and 2_1998_2001.html.
const ARCHIVE_PAGE_RE = /^\/Archives\/2_[\d_]+\.html?$/i;

const squash = (s) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

function tryCanonical(href, base) {
  try {
    return canonicalUrl(href, base);
  } catch {
    return null;
  }
}

export function isExperienceUrl(url) {
  const u = new URL(url);
  return (
    (u.hostname === 'www.nderf.org' && /^\/Experiences\/[^/]+\.html?$/i.test(u.pathname)) ||
    (u.hostname === 'search.nderf.org' && /^\/(exp|experience)\/\d+\/?$/.test(u.pathname))
  );
}

export function archivePageUrls(html, baseUrl) {
  const $ = cheerio.load(html);
  const urls = new Set();
  $('a[href]').each((_, a) => {
    const url = tryCanonical($(a).attr('href'), baseUrl);
    if (url && ARCHIVE_PAGE_RE.test(new URL(url).pathname)) urls.add(url);
  });
  return [...urls];
}

// Every index page to read, given the archive list's HTML.
export function allIndexUrls(archiveListHtml) {
  return [...archivePageUrls(archiveListHtml, ARCHIVE_LIST_URL), CURRENT_URL, EXCEPTIONAL_URL];
}

// "2015-H1", "2003", "1998-2001", or "current" for the not-yet-archived page.
export function archivePeriod(indexUrl) {
  const name = path.basename(new URL(indexUrl).pathname).replace(/\.html?$/i, '');
  let m;
  if ((m = name.match(/^2_([16])_(\d{4})(?:_\d+)?$/))) return `${m[2]}-H${m[1] === '1' ? 1 : 2}`;
  if ((m = name.match(/^2_(\d{4})$/))) return m[1];
  if ((m = name.match(/^2_(\d{4})_(\d{4})$/))) return `${m[1]}-${m[2]}`;
  if (name === 'NDERF_NDEs') return 'current';
  return null;
}

// "6/25/2024." -> "2024-06-25"
export function isoDate(mdy) {
  const m = mdy?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}

// Each entry on an index page is a flat run of nodes:
//   1234. <a>Jane D NDE</a> <span.m110>6/25/2024.</span> <span.m105>NDE 5678.</span>
//   <span.m107>Exceptional Experience</span> excerpt… <span.m105>editor's summary</span>
// m107 holds either a country ("From Canada") or a flag like "Exceptional Experience".
// The excerpt is a quote from the account itself, so it is not kept.
export function parseIndexEntries(html, indexUrl) {
  const $ = cheerio.load(html);
  const anchors = [];
  $('a[href]').each((_, a) => {
    const url = tryCanonical($(a).attr('href'), indexUrl);
    if (url && isExperienceUrl(url)) anchors.push({ node: a, url });
  });
  const anchorNodes = new Set(anchors.map((a) => a.node));

  return anchors.map(({ node, url }) => {
    const prev = node.prev;
    const seq = prev?.type === 'text' ? prev.data.match(/(\d+)\.\s*$/)?.[1] : undefined;

    const spans = { m110: [], m105: [], m107: [] };
    for (let n = node.next; n && !anchorNodes.has(n); n = n.next) {
      if (n.type !== 'tag' || n.name !== 'span') continue;
      const cls = $(n).attr('class');
      if (Object.hasOwn(spans, cls ?? '')) spans[cls].push(squash($(n).text()));
    }

    // Reposted accounts list several dates: "10/26/2026 & 12/22/2019".
    const posted = spans.m110[0]?.replace(/\.$/, '') || null;
    // "NDE 5678", or "NDE 30001/7001" when an account has both a new and an old number.
    const label = spans.m105[0]?.replace(/\.$/, '') || null;
    const labelParts = label?.match(/^(.*?)\s*(\d+(?:\s*\/\s*\d+)*)$/);
    return {
      index_url: indexUrl,
      archive_period: archivePeriod(indexUrl),
      url,
      link_text: squash($(node).text()),
      seq: seq ? Number(seq) : null,
      posted_raw: posted,
      posted_dates: [...(posted ?? '').matchAll(/\d{1,2}\/\d{1,2}\/\d{4}/g)].map((m) => isoDate(m[0])),
      type_label: labelParts ? labelParts[1] || null : label,
      nderf_numbers: labelParts ? labelParts[2].split('/').map(Number) : [],
      tag: spans.m107[0] || null,
      editor_summary: spans.m105.length > 1 ? spans.m105.at(-1) : null,
    };
  });
}
