import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA_DIR = path.join(ROOT, 'data');
export const RAW_DIR = path.join(DATA_DIR, 'raw');
export const FETCH_LOG = path.join(RAW_DIR, 'fetch_log.jsonl');

// http://nderf.org/X and https://www.nderf.org/X are the same page; the archive links to both.
export function canonicalUrl(href, base) {
  const u = new URL(href, base);
  u.protocol = 'https:';
  u.hash = '';
  if (u.hostname === 'nderf.org') u.hostname = 'www.nderf.org';
  return u.toString();
}

// Mirrors the URL under data/raw/<host>/<path>, adding .html when the path has no extension.
// The server is case-sensitive but macOS filesystems usually aren't, so a file name with
// uppercase letters gets a short hash of the exact name to keep it from colliding.
export function rawPathFor(url) {
  const u = new URL(url);
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const segments = p.split('/').filter((s) => s && s !== '.' && s !== '..');
  let name = segments.pop();
  const ext = path.extname(name) || '.html';
  const stem = path.basename(name, path.extname(name));
  if (stem !== stem.toLowerCase()) {
    name = `${stem}~${createHash('sha256').update(stem).digest('hex').slice(0, 8)}${ext}`;
  } else {
    name = stem + ext;
  }
  return path.join(RAW_DIR, u.hostname, ...segments, name);
}

export function relativeToRoot(file) {
  return path.relative(ROOT, file);
}
