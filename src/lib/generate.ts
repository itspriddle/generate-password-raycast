import { pick, RandomInt, sample, secureRandomInt, shuffle } from "./random";

export const DIGITS = "0123456789";
export const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
export const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const SYMBOLS = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 1024;
export const MAX_PASSPHRASE_WORDS = 100;
export const MAX_PIN_LENGTH = 256;

/** Below this many candidate words, passphrases lose entropy quickly. */
export const SMALL_WORD_POOL = 2000;

export type GeneratorType = "password" | "passphrase" | "pin";

export interface PasswordOptions {
  length: number;
  numbers: boolean;
  symbols: boolean;
  uppercase: boolean;
  lowercase: boolean;
}

export interface PassphraseOptions {
  words: number;
  delimiter: string;
  minWordLength: number;
  maxWordLength: number;
  uppercaseWords: number;
}

export interface PinOptions {
  length: number;
}

export type GeneratorSpec =
  | { type: "password"; options: PasswordOptions }
  | { type: "passphrase"; options: PassphraseOptions; wordlist: readonly string[] }
  | { type: "pin"; options: PinOptions };

export interface GenerationResult {
  values: string[];
  /** Estimated entropy of a single value, in bits. */
  entropyBits: number;
  warning?: string;
}

/** A user-facing validation error; its message is safe to display. */
export class GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationError";
  }
}

export function requireInteger(label: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new GenerationError(`${label} must be a whole number between ${min} and ${max}`);
  }
}

function passwordClasses(options: PasswordOptions): string[] {
  return [
    options.numbers ? DIGITS : "",
    options.symbols ? SYMBOLS : "",
    options.uppercase ? UPPERCASE : "",
    options.lowercase ? LOWERCASE : "",
  ].filter((chars) => chars.length > 0);
}

function validatePassword(options: PasswordOptions): string[] {
  requireInteger("Password length", options.length, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH);

  const classes = passwordClasses(options);

  if (classes.length === 0) {
    throw new GenerationError("Enable at least one of numbers, symbols, uppercase, or lowercase");
  }

  return classes;
}

/**
 * Generates a password that contains at least one character from each enabled
 * class, filling the remainder from the union of enabled classes.
 */
export function generatePassword(options: PasswordOptions, rand: RandomInt = secureRandomInt): string {
  const classes = validatePassword(options);
  const all = classes.join("");
  const chars = classes.map((set) => pick(set, rand));

  while (chars.length < options.length) {
    chars.push(pick(all, rand));
  }

  return shuffle(chars, rand).join("");
}

function validatePassphrase(options: PassphraseOptions): void {
  requireInteger("Word count", options.words, 1, MAX_PASSPHRASE_WORDS);
  requireInteger("Minimum word length", options.minWordLength, 1, 100);
  requireInteger("Maximum word length", options.maxWordLength, 1, 100);
  requireInteger("Uppercase word count", options.uppercaseWords, 0, MAX_PASSPHRASE_WORDS);

  if (options.minWordLength > options.maxWordLength) {
    throw new GenerationError("Minimum word length must be less than or equal to maximum word length");
  }

  if ([...options.delimiter].length > 1) {
    throw new GenerationError("Delimiter must be a single character");
  }
}

/**
 * Returns the unique words whose length falls within [min, max]. Words that
 * contain the delimiter (e.g. "yo-yo" with "-") are dropped so the passphrase
 * stays unambiguous.
 */
export function filterWordlist(wordlist: readonly string[], min: number, max: number, delimiter = ""): string[] {
  const pool = new Set<string>();

  for (const word of wordlist) {
    const length = [...word].length;

    if (length >= min && length <= max && (delimiter === "" || !word.includes(delimiter))) {
      pool.add(word.toLowerCase());
    }
  }

  return [...pool];
}

function buildPassphrase(options: PassphraseOptions, pool: readonly string[], rand: RandomInt): string {
  const words = sample(pool, options.words, rand);
  const upcase = new Set(sample([...words.keys()], Math.min(options.uppercaseWords, words.length), rand));

  return words.map((word, i) => (upcase.has(i) ? word.toUpperCase() : word)).join(options.delimiter);
}

function passphrasePool(options: PassphraseOptions, wordlist: readonly string[]): string[] {
  validatePassphrase(options);

  const pool = filterWordlist(wordlist, options.minWordLength, options.maxWordLength, options.delimiter);

  if (pool.length < options.words) {
    throw new GenerationError(
      `Only ${pool.length} words are between ${options.minWordLength} and ${options.maxWordLength} characters; ` +
        `need at least ${options.words}`,
    );
  }

  return pool;
}

/**
 * Generates a passphrase of distinct, lowercase words, with
 * `uppercaseWords` of them (chosen at random) in UPPERCASE.
 */
export function generatePassphrase(
  options: PassphraseOptions,
  wordlist: readonly string[],
  rand: RandomInt = secureRandomInt,
): string {
  return buildPassphrase(options, passphrasePool(options, wordlist), rand);
}

export function generatePin(options: PinOptions, rand: RandomInt = secureRandomInt): string {
  requireInteger("PIN length", options.length, 1, MAX_PIN_LENGTH);

  return Array.from({ length: options.length }, () => pick(DIGITS, rand)).join("");
}

/** log2(n * (n-1) * ... * (n-k+1)): choosing k ordered words without replacement. */
function log2Permutations(n: number, k: number): number {
  let bits = 0;

  for (let i = 0; i < k; i++) {
    bits += Math.log2(n - i);
  }

  return bits;
}

/** Generates `count` values for the spec, validating options once up front. */
export function generate(spec: GeneratorSpec, count = 1, rand: RandomInt = secureRandomInt): GenerationResult {
  switch (spec.type) {
    case "password": {
      const pool = validatePassword(spec.options).join("").length;

      return {
        values: Array.from({ length: count }, () => generatePassword(spec.options, rand)),
        entropyBits: spec.options.length * Math.log2(pool),
      };
    }
    case "passphrase": {
      const pool = passphrasePool(spec.options, spec.wordlist);

      return {
        values: Array.from({ length: count }, () => buildPassphrase(spec.options, pool, rand)),
        entropyBits: log2Permutations(pool.length, spec.options.words),
        warning:
          pool.length < SMALL_WORD_POOL
            ? `Only ${pool.length} words match the word length settings; consider a larger word list or range`
            : undefined,
      };
    }
    case "pin":
      return {
        values: Array.from({ length: count }, () => generatePin(spec.options, rand)),
        entropyBits: spec.options.length * Math.log2(DIGITS.length),
      };
  }
}
