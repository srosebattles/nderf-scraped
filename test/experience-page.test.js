import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseExperiencePage, splitResponse } from '../src/lib/experience-page.js';

// Synthetic fixtures that mimic NDERF's markup; no real account text.
const page = (content) => `<html><head><meta charset="utf-8"></head><body>
<section><ul>
  <li><a href="../index.htm" class="color_grey_light_3">Home</a></li>
  <li><a href="#" class="color_grey_light_3">Classification Probable NDE</a></li>
  <li><a class="color_grey_light_3">101 Pat Q Probable NDE 9000</a></li>
</ul></section>
<!--content-->
<section class="section_offset"><div class="container">${content}</div></section>
</body></html>`;

const CLASS_MARKUP = page(`
<span class="m108">Experience Description</span><br><br>
First paragraph of the story.<br>
Second paragraph,
continued on a new source line.
<br><br><span class="m108">Background Information:</span>
<br><br><span class="m105">Gender:</span>	Female
<br><br><span class="m105">Date NDE Occurred:</span>	 10/1990
<br><br><span class="m108">NDE Elements: </span>
<br><span class="m105">Did you feel separated from your body?</span>   Yes
I clearly left my body
<br><br><span class="m105">Were your thoughts speeded up?</span>      No
<br><br><span class="m108">God, Spiritual and Religion:</span>
<br><span class="m105">What was your religion prior to your experience?</span>   Christian- Catholic   Raised in it.
`);

const STYLE_MARKUP = page(`
<h3><strong>Experience Description</strong></h3>
<h5><p>The story.</p></h5>
<p><span style="color:#0080FF">Background Information:  </span><br>
<p><span style="color: #009999">Gender:	</span>Male<br>
<span style="color:#0080FF">NDE Elements:  </span><br>
<p><span style="color: #009999">How do you consider the content of your experience? </span>    Mixed
`);

test('parses class-based static pages', () => {
  const r = parseExperiencePage(CLASS_MARKUP, 'https://www.nderf.org/Experiences/1pat_q_nde.html');
  assert.equal(r.template, 'static');
  assert.equal(r.page_classification, 'Probable NDE');
  assert.equal(r.page_header, '101 Pat Q Probable NDE 9000');
  assert.equal(r.parts.length, 1);
  const [p] = r.parts;
  assert.equal(p.narrative, 'First paragraph of the story.\nSecond paragraph, continued on a new source line.');
  assert.deepEqual(p.background, { Gender: 'Female', 'Date NDE Occurred': '10/1990' });
  assert.deepEqual(p.qa, [
    {
      section: 'NDE Elements',
      question: 'Did you feel separated from your body?',
      response: 'Yes I clearly left my body',
      answer: 'Yes',
      comment: 'I clearly left my body',
    },
    {
      section: 'NDE Elements',
      question: 'Were your thoughts speeded up?',
      response: 'No',
      answer: 'No',
      comment: null,
    },
    {
      section: 'God, Spiritual and Religion',
      question: 'What was your religion prior to your experience?',
      response: 'Christian- Catholic Raised in it.',
      answer: 'Christian- Catholic',
      comment: 'Raised in it.',
    },
  ]);
  assert.deepEqual(r.warnings, []);
});

test('parses inline-colour static pages', () => {
  const r = parseExperiencePage(STYLE_MARKUP, 'https://www.nderf.org/Experiences/1pat_q_nde.html');
  const [p] = r.parts;
  assert.equal(p.narrative, 'The story.');
  assert.deepEqual(p.background, { Gender: 'Male' });
  assert.equal(p.qa[0].answer, 'Mixed');
  assert.equal(p.qa[0].section, 'NDE Elements');
});

test('splits pages with several submissions into parts', () => {
  const html = page(`
<span class="m108">Experience Description 200</span><br>Later telling.
<br><span class="m108">Background Information:</span><br><span class="m105">Gender:</span> Female
<br><span class="m108">Experience Description 150</span><br>Earlier telling.
<br><span class="m108">Background Information:</span><br><span class="m105">Gender:</span> Female`);
  const r = parseExperiencePage(html, 'https://www.nderf.org/Experiences/x_nde_150.htm');
  assert.deepEqual(
    r.parts.map((p) => [p.submission_number, p.narrative, p.background.Gender]),
    [
      [200, 'Later telling.', 'Female'],
      [150, 'Earlier telling.', 'Female'],
    ],
  );
});

test('accepts "Describe the Experience" headings and keeps questions out of background', () => {
  const html = page(`
<span class="m108">Experience Description</span>
<span class="m108">Describe the Experience: 9383</span><br>The story.
<br><span class="m108">Background Information:</span>
<br><span class="m105">Gender:</span> Male
<br><span class="m105">Did you see a light?</span>   Yes   A soft one.`);
  const { parts } = parseExperiencePage(html, 'https://www.nderf.org/Experiences/a.html');
  assert.equal(parts.length, 1, 'the empty "Experience Description" heading is not a part');
  const [p] = parts;
  assert.equal(p.submission_number, 9383);
  assert.equal(p.narrative, 'The story.');
  assert.deepEqual(p.background, { Gender: 'Male' });
  assert.equal(p.qa[0].question, 'Did you see a light?');
  assert.equal(p.qa[0].section, 'Background Information');
});

test('reports pages without a questionnaire', () => {
  const r = parseExperiencePage(page('<h3>Experience Description</h3><p>Only a story.</p>'), 'https://www.nderf.org/Experiences/a.html');
  assert.equal(r.parts[0].narrative, 'Only a story.');
  assert.deepEqual(r.warnings, ['no questionnaire']);
});

test('parses search-app pages', () => {
  const html = `<html><body>
<h1 class="exp-title">P. Q</h1><span class="exp-entrynums">#30002</span>
<span class="exp-badge exp-badge--classification">STE</span>
<span class="exp-badge exp-badge--greyson">Greyson Scale: 14</span>
<span class="quick-facts-label">Date Submitted</span><span class="quick-facts-value">9/16/2026</span>
<div class="exp-narrative-content">
  <h2 class="exp-section-header">Experience Description</h2>
  <div class="exp" style="white-space: pre-line;">
First line.
Second line.</div>
  <h2 class="exp-section-header">Near Death Experience Elements</h2>
  <div class="exp-section"><div class="exp-p">Did you pass into or through a tunnel?</div>
    <div class="exp-a">
      No
    </div></div>
</div></body></html>`;
  const r = parseExperiencePage(html, 'https://search.nderf.org/experience/30002');
  assert.equal(r.template, 'search-app');
  assert.equal(r.page_header, 'P. Q #30002');
  assert.equal(r.page_classification, 'STE');
  assert.equal(r.greyson_score, 14);
  assert.deepEqual(r.quick_facts, { 'Date Submitted': '9/16/2026' });
  assert.equal(r.parts[0].narrative, 'First line.\nSecond line.');
  assert.deepEqual(r.parts[0].qa, [
    {
      section: 'Near Death Experience Elements',
      question: 'Did you pass into or through a tunnel?',
      response: 'No',
      answer: 'No',
      comment: null,
    },
  ]);
});

test('splitResponse separates a short choice from the comment', () => {
  assert.deepEqual(splitResponse('Yes   Accident   Was unconscious'), { answer: 'Yes', comment: 'Accident Was unconscious' });
  assert.deepEqual(splitResponse('  Entirely pleasant  '), { answer: 'Entirely pleasant', comment: null });
  const long = 'x'.repeat(90);
  assert.deepEqual(splitResponse(long), { answer: null, comment: long });
  assert.deepEqual(splitResponse(''), { answer: null, comment: null });
});
