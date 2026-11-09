import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bestContainment,
  classifySearchEntries,
  entryUrl,
  listingPageError,
  listingUrl,
  nameKey,
} from '../src/lib/search-listing.js';

// Synthetic entries shaped like the search API's results and our index entries.
const searchEntry = (num, name, posted, extra = {}) => ({
  ENTRYNUM: String(num),
  POSTNAME: name,
  URL: `https://search.nderf.org/experience/${num}`,
  POSTDATE: [`${posted}T10:00:00.000Z`],
  CLASSIFICATION: ['NDE'],
  experiences: [{ ENTRYNUM: num }],
  ...extra,
});
const indexEntry = (url, linkText, posted, numbers = []) => ({
  url,
  link_text: linkText,
  posted_dates: [posted],
  nderf_numbers: numbers,
});

test('nameKey drops classifications and prefers transliterations', () => {
  assert.equal(nameKey('Example X. Probable NDE and ADC'), 'example x');
  assert.equal(nameKey('Stéphane S STEs'), 'stephane s');
  assert.equal(nameKey('Алексей (Aleksey)'), 'aleksey');
  assert.equal(nameKey('Mike Smith (Mike S)'), 'mike smith');
});

test('classifySearchEntries matches by number, then by name and date', () => {
  const index = [
    indexEntry('https://www.nderf.org/Experiences/sam_q_nde_30001.htm', 'Sam Q NDE', '2025-01-02'),
    indexEntry('https://www.nderf.org/Experiences/1pat_r_nde.html', 'Pat R NDE', '2025-03-01', [9001]),
    indexEntry('https://www.nderf.org/Experiences/lee_t_nde_13000.htm', 'Lee T NDE', '2025-04-01'),
    indexEntry('https://www.nderf.org/Experiences/1kim_w_nde.html', 'Kim W NDE', '2019-01-01'),
  ];
  const dead = new Set(['https://www.nderf.org/Experiences/lee_t_nde_13000.htm']);
  const result = classifySearchEntries(
    [
      searchEntry(30001, 'Sam Q', '2025-01-01'), // number in the static URL
      searchEntry(30002, 'Pat R', '2025-02-20'), // same name, posted within a year
      searchEntry(30003, 'Lee T', '2025-03-30'), // matches only a dead static page
      searchEntry(30004, 'Kim W', '2025-05-01'), // same name, but six years apart
    ],
    index,
    (url) => dead.has(url),
  );
  assert.deepEqual(
    result.map((r) => [r.entry.ENTRYNUM, r.status, r.matches.length]),
    [
      ['30001', 'listed', 1],
      ['30002', 'listed', 1],
      ['30003', 'dead', 1],
      ['30004', 'unlisted', 0],
    ],
  );
});

test('bestContainment finds the record that contains a candidate text', () => {
  const story = 'I rose above the bed and watched the nurses work while a warm light filled the room';
  const [hit, miss] = bestContainment(
    [`${story} and then I woke up`, 'a completely different account about walking through a quiet forest at night'],
    [
      { id: 'other', text: 'nothing in common with either of these texts at all' },
      { id: 'same', text: `Before that, ${story}.` },
    ],
  );
  assert.equal(hit.id, 'same');
  assert.ok(hit.score > 0.7, `score ${hit.score}`);
  assert.equal(miss.score, 0);
});

test('listing helpers', () => {
  const e = new URL(listingUrl(3)).searchParams.get('e');
  assert.equal(Buffer.from(e, 'base64').toString(), 'sort=POSTDATE&lang=en&page=3');
  assert.equal(listingPageError('{"results":[{"ENTRYNUM":"1"}]}'), null);
  assert.equal(listingPageError('{"error":"Server temporarily not available"}'), 'Server temporarily not available');
  assert.equal(listingPageError('<html>'), 'not JSON');
  assert.equal(entryUrl({ URL: 'http://nderf.org/Experiences/1a_nde.html' }), 'https://www.nderf.org/Experiences/1a_nde.html');
  assert.equal(entryUrl({ ENTRYNUM: '33001' }), 'https://search.nderf.org/experience/33001');
});
