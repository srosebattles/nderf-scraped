import * as cheerio from 'cheerio';

// Experience pages come in two families:
//
// static (www.nderf.org/Experiences/…): a flat run of text where questions and section
//   headings are marked only by styling. Older pages use inline colours
//   (<span style="color:#0080FF"> headings, <span style="color: #009999"> questions); newer ones
//   use classes (span.m108 headings, span.m105 questions). Some pages mix both, and the oldest
//   are a narrative with no questionnaire at all. A question's response is all the text up to
//   the next question or heading.
//
// search-app (search.nderf.org/experience/…): proper markup, with h2.exp-section-header
//   headings and div.exp-section > div.exp-p (question) + div.exp-a (response), plus
//   "quick facts" such as Date Submitted and a Greyson Scale badge.
//
// A page can hold more than one submission of the same experience, each starting with its own
// "Experience Description 12345" heading. Each submission becomes one of the record's `parts`.

// Some pages head the account "Describe the Experience" instead.
const DESCRIPTION_RE = /^(Experience Description|Describe the Experience)\b/i;
const isDescription = (section) => DESCRIPTION_RE.test(section ?? '');
const BACKGROUND = 'Background Information';
const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'table', 'tr', 'section']);

// An "answer" is a short leading choice such as "Yes" or "Incredibly more vivid"; anything
// longer is treated as free text with no separate answer.
const MAX_ANSWER_LENGTH = 80;

const squash = (s) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const sectionName = (s) => squash(s).replace(/:$/, '').trim();

// Keeps line breaks (from <br> and block boundaries) but collapses spaces within lines and
// runs of blank lines.
export function normalizeText(s) {
  return s
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// The questionnaire renders a multiple-choice answer and the person's comment as one string,
// separated by a run of spaces or a line break: "Yes   Accident   Was unconscious". Splitting there
// is a heuristic, so `response` always keeps the full text.
export function splitResponse(raw) {
  const s = raw.replace(/ /g, ' ').replace(/^\s+/, '');
  const m = s.match(/^(.+?)(?:[ \t]{2,}|\t|\n)\s*(\S[\s\S]*)$/);
  const [head, rest] = m ? [m[1], m[2]] : [s, ''];
  if (normalizeText(head).length > MAX_ANSWER_LENGTH) {
    return { answer: null, comment: normalizeText(s) || null };
  }
  return { answer: normalizeText(head) || null, comment: normalizeText(rest) || null };
}

function markerKind($, el) {
  if (el.name === 'span') {
    const cls = $(el).attr('class') ?? '';
    const style = ($(el).attr('style') ?? '').toUpperCase();
    if (/\bm108\b/.test(cls) || style.includes('#0080FF')) return 'section';
    if (/\bm105\b/.test(cls) || style.includes('#009999')) return 'label';
  }
  if (/^h[1-4]$/.test(el.name) && isDescription(squash($(el).text()))) return 'section';
  return null;
}

// Flattens the content into a list of {kind: 'section' | 'label' | 'text', text} tokens.
// Source newlines are whitespace, as in a browser; <br> and block elements are line breaks.
// Source newlines become a double space so splitResponse still sees them as a gap
// ("Yes⏎I clearly left my body").
function tokenize($, root) {
  const tokens = [];
  const walk = (node) => {
    if (node.type === 'text') {
      tokens.push({ kind: 'text', text: node.data.replace(/[\r\n]+/g, '  ') });
      return;
    }
    if (node.type !== 'tag' || node.name === 'script' || node.name === 'style') return;
    const kind = markerKind($, node);
    if (kind) {
      tokens.push({ kind, text: $(node).text() });
      return;
    }
    if (node.name === 'br') {
      tokens.push({ kind: 'text', text: '\n' });
      return;
    }
    const block = BLOCK_TAGS.has(node.name);
    if (block) tokens.push({ kind: 'text', text: '\n' });
    for (const child of node.children ?? []) walk(child);
    if (block) tokens.push({ kind: 'text', text: '\n' });
  };
  walk(root);
  return tokens;
}

// Every description heading after the first starts a new part.
function partCounter() {
  let part = 0;
  let seenDescription = false;
  return (section) => {
    if (isDescription(section)) {
      if (seenDescription) part++;
      seenDescription = true;
    }
    return part;
  };
}

// Groups tokens into {part, section, label, raw} blocks: text after a question belongs to it
// until the next question or heading; text before any question in a section is unlabeled.
function groupBlocks(tokens) {
  const blocks = [];
  const partFor = partCounter();
  let part = 0;
  let section = null;
  let current = null;
  for (const t of tokens) {
    if (t.kind === 'section') {
      section = sectionName(t.text);
      part = partFor(section);
      current = null;
    } else if (t.kind === 'label') {
      current = { part, section, label: squash(t.text), raw: '' };
      blocks.push(current);
    } else {
      if (!current) {
        current = { part, section, label: null, raw: '' };
        blocks.push(current);
      }
      current.raw += t.text;
    }
  }
  return blocks;
}

function assemblePart(blocks) {
  const heading = blocks.find((b) => isDescription(b.section))?.section ?? null;
  const narrative = [];
  const background = {};
  const qa = [];
  const otherText = [];
  for (const b of blocks) {
    const text = normalizeText(b.raw);
    const inDescription = b.section === null || isDescription(b.section);
    if (b.label === null) {
      if (!text) continue;
      if (inDescription) narrative.push(text);
      else otherText.push({ section: b.section, text });
    } else if (b.section?.startsWith(BACKGROUND) && !b.label.endsWith('?')) {
      // Fields like "Gender:". A few pages put the whole questionnaire under this heading, so
      // anything phrased as a question goes to `qa` instead.
      const base = b.label.replace(/:$/, '').trim();
      let key = base;
      for (let i = 2; key in background; i++) key = `${base} (${i})`;
      background[key] = text;
    } else {
      qa.push({ section: b.section, question: b.label, response: text, ...splitResponse(b.raw) });
    }
  }
  return {
    heading,
    // Headings usually end in a submission number, but some end in a date instead.
    submission_number: Number(heading?.match(/^(?:Experience Description|Describe the Experience):?\s+(\d+)$/i)?.[1]) || null,
    narrative: narrative.join('\n\n'),
    background,
    qa,
    other_text: otherText,
  };
}

// A heading with nothing under it (e.g. "Experience Description" directly followed by
// "Describe the Experience") isn't a separate submission.
const isEmptyPart = (p) =>
  !p.narrative && !p.qa.length && !p.other_text.length && !Object.keys(p.background).length;

function assemble(blocks) {
  const byPart = Map.groupBy(blocks, (b) => b.part);
  const parts = [...byPart.keys()].sort((a, b) => a - b).map((k) => assemblePart(byPart.get(k)));
  return { parts: parts.filter((p) => !isEmptyPart(p)) };
}

function parseStatic($) {
  // Breadcrumb: "… > Classification Probable NDE > 1234 Jane D Probable NDE 5678"
  const crumbs = $('li a.color_grey_light_3')
    .map((_, a) => squash($(a).text()))
    .get();
  const classification = crumbs.find((c) => c.startsWith('Classification '))?.slice(15) || null;
  const header = crumbs.at(-1) && crumbs.at(-1) !== 'Home' ? crumbs.at(-1) : null;

  // The account is in the content <section> with the most text.
  let root = null;
  let longest = -1;
  $('section.section_offset').each((_, el) => {
    const len = $(el).text().length;
    if (len > longest) [root, longest] = [el, len];
  });
  const parsed = root ? assemble(groupBlocks(tokenize($, root))) : null;
  return {
    template: 'static',
    page_header: header,
    page_classification: classification,
    greyson_score: null,
    quick_facts: null,
    ...(parsed ?? { parts: [] }),
  };
}

function parseSearchApp($) {
  const quickFacts = {};
  $('.quick-facts-label').each((_, el) => {
    const key = squash($(el).text()).replace(/:$/, '');
    if (key && !(key in quickFacts)) quickFacts[key] = squash($(el).next('.quick-facts-value').text());
  });
  const greyson = squash($('.exp-badge--greyson').first().text()).match(/(\d+)/)?.[1];

  const blocks = [];
  const partFor = partCounter();
  $('h2.exp-section-header').each((_, h) => {
    const section = sectionName($(h).text());
    const part = partFor(section);
    $(h)
      .nextUntil('h2.exp-section-header')
      .each((_, el) => {
        if ($(el).is('.exp-section') && $(el).children('.exp-p').length) {
          const label = squash($(el).children('.exp-p').text());
          blocks.push({ part, section, label, raw: textWithBreaks($, $(el).children('.exp-a')[0]) });
        } else {
          blocks.push({ part, section, label: null, raw: textWithBreaks($, el) });
        }
      });
  });

  const title = squash($('h1.exp-title').first().text());
  const numbers = squash($('.exp-entrynums').first().text());
  return {
    template: 'search-app',
    page_header: [title, numbers].filter(Boolean).join(' ') || null,
    page_classification: squash($('.exp-badge--classification').first().text()) || null,
    greyson_score: greyson ? Number(greyson) : null,
    quick_facts: quickFacts,
    ...assemble(blocks),
  };
}

// The search app's answers use `white-space: pre-line`, so their newlines are real.
function textWithBreaks($, el) {
  if (!el) return '';
  if (el.type === 'text') return el.data;
  if (el.type !== 'tag' || el.name === 'script' || el.name === 'style') return '';
  if (el.name === 'br') return '\n';
  const inner = (el.children ?? []).map((c) => textWithBreaks($, c)).join('');
  return BLOCK_TAGS.has(el.name) ? `\n${inner}\n` : inner;
}

export function parseExperiencePage(html, url) {
  const $ = cheerio.load(html);
  const page = new URL(url).hostname === 'search.nderf.org' ? parseSearchApp($) : parseStatic($);

  const warnings = [];
  if (!page.parts.length) warnings.push('no account content (may be a "this page has moved" notice)');
  if (!page.parts.some((p) => p.narrative)) warnings.push('no narrative');
  if (!page.parts.some((p) => p.qa.length)) warnings.push('no questionnaire');
  if (page.parts.some((p) => p.other_text.length)) warnings.push('unlabeled text outside the description');
  if (html.includes('�')) warnings.push('contains U+FFFD (bad character encoding)');
  return { ...page, warnings };
}
