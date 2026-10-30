import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allIndexUrls, archivePeriod, parseIndexEntries } from '../src/lib/index-page.js';

// Synthetic fixtures that mimic NDERF's markup; no real account text.
const INDEX_HTML = `
<span class="m103">
12.
<a href="http://www.nderf.org/Experiences/1jane_d_nde.html" class="MiniLink">Jane D NDE</a>
<span class="m110">  3/25/1999.</span>
<span class="m105">  Secondhand NDE 10001.</span>
<span class="m107"> From Canada  </span>
An excerpt that should not be kept.
<span class="m105">Editor summary one.</span>
<br><br>
11.
<a href="https://www.nderf.org/Experiences/sam_q_probable_nde_30001.htm" class="MiniLink">Sam Q Probable NDE</a>
<span class="m110">10/26/2026 &amp; 12/22/2019.</span>
<span class="m105">NDE 30001/7001.</span>
Another excerpt.
<span class="m105">Editor summary two.</span>
<br><br>
<a href="https://www.nderf.org/Archives/2_1_2015.html">not an account</a>
</span>`;

test('parses index entries', () => {
  const entries = parseIndexEntries(INDEX_HTML, 'https://www.nderf.org/Archives/2_1998_2001.html');
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    index_url: 'https://www.nderf.org/Archives/2_1998_2001.html',
    archive_period: '1998-2001',
    url: 'https://www.nderf.org/Experiences/1jane_d_nde.html',
    link_text: 'Jane D NDE',
    seq: 12,
    posted_raw: '3/25/1999',
    posted_dates: ['1999-03-25'],
    type_label: 'Secondhand NDE',
    nderf_numbers: [10001],
    tag: 'From Canada',
    editor_summary: 'Editor summary one.',
  });
  assert.deepEqual(entries[1].posted_dates, ['2026-10-26', '2019-12-22']);
  assert.deepEqual(entries[1].nderf_numbers, [30001, 7001]);
  assert.equal(entries[1].tag, null);
});

test('maps index page names to archive periods', () => {
  const p = (name) => archivePeriod(`https://www.nderf.org/Archives/${name}`);
  assert.equal(p('2_1_2015.html'), '2015-H1');
  assert.equal(p('2_6_2010_2.html'), '2010-H2');
  assert.equal(p('2_2003.html'), '2003');
  assert.equal(p('2_1998_2001.html'), '1998-2001');
  assert.equal(p('NDERF_NDEs.html'), 'current');
  assert.equal(p('exceptional.html'), null);
});

test('lists archive pages plus the current and exceptional pages', () => {
  const html = `<a href="2_1_2015.html">a</a><a href="https://www.nderf.org/Archives/2_6_2010_1.html">b</a>
    <a href="../index.htm">home</a><a href="2_1_2015.html">dup</a>`;
  assert.deepEqual(allIndexUrls(html), [
    'https://www.nderf.org/Archives/2_1_2015.html',
    'https://www.nderf.org/Archives/2_6_2010_1.html',
    'https://www.nderf.org/Archives/NDERF_NDEs.html',
    'https://www.nderf.org/Archives/exceptional.html',
  ]);
});
