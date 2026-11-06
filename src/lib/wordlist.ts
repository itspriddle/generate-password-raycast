import { readFileSync, statSync } from "node:fs";
import { GenerationError } from "./generate";

/** Guard against accidentally selecting a huge or binary file. */
export const MAX_WORDLIST_BYTES = 5 * 1024 * 1024;

const cache = new Map<string, readonly string[]>();

/** Splits file contents into unique, trimmed, non-empty words. */
export function parseWordlist(contents: string): string[] {
  const words = contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/\s/.test(line));

  return [...new Set(words)];
}

/** Reads and caches a word list (one word per line). */
export function readWordlist(path: string): readonly string[] {
  const cached = cache.get(path);

  if (cached) {
    return cached;
  }

  let contents: string;

  try {
    const stats = statSync(path);

    if (!stats.isFile()) {
      throw new GenerationError(`Word list is not a file: ${path}`);
    }

    if (stats.size > MAX_WORDLIST_BYTES) {
      throw new GenerationError(`Word list is larger than ${MAX_WORDLIST_BYTES / 1024 / 1024}MB: ${path}`);
    }

    contents = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof GenerationError) {
      throw error;
    }

    throw new GenerationError(`Could not read word list: ${path}`);
  }

  const words = parseWordlist(contents);

  if (words.length === 0) {
    throw new GenerationError(`Word list is empty: ${path}`);
  }

  cache.set(path, words);

  return words;
}
