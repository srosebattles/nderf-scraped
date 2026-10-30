import fs from 'node:fs/promises';
import { FETCH_LOG } from './paths.js';

// The latest fetch-log entry for each URL.
export async function readFetchLog() {
  const latest = new Map();
  const text = await fs.readFile(FETCH_LOG, 'utf8').catch(() => '');
  for (const line of text.split('\n')) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // blank, or a line the crawler is still writing
    }
    latest.set(entry.url, entry);
  }
  return latest;
}
