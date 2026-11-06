import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DIGITS,
  filterWordlist,
  generate,
  generatePassphrase,
  generatePassword,
  generatePin,
  GenerationError,
  LOWERCASE,
  PasswordOptions,
  SYMBOLS,
  UPPERCASE,
} from "./generate";
import {
  applyOverrides,
  DEFAULT_SETTINGS,
  parsePreferences,
  parseStoredState,
  sanitizeOverrides,
  sizeOf,
  sizeOverride,
} from "./options";
import { RandomInt, sample, shuffle } from "./random";
import { parseWordlist } from "./wordlist";

const EFF = parseWordlist(readFileSync(join(__dirname, "../../assets/eff_large_wordlist.txt"), "utf8"));
const RUNS = 500;

const has = (value: string, set: string) => [...value].some((c) => set.includes(c));

/** Deterministic RNG that always returns 0. */
const zero: RandomInt = () => 0;

describe("random", () => {
  it("shuffle with a fixed RNG is deterministic and a permutation", () => {
    // Fisher–Yates with j=0 at every step rotates the array.
    expect(shuffle([1, 2, 3, 4], zero)).toEqual([2, 3, 4, 1]);
  });

  it("sample returns distinct items", () => {
    const picked = sample([...Array(50).keys()], 50, (max) => Math.floor(max / 2));
    expect(new Set(picked).size).toBe(50);
  });

  it("sample rejects oversized requests", () => {
    expect(() => sample([1, 2], 3, zero)).toThrow(RangeError);
  });
});

describe("generatePassword", () => {
  const defaults = DEFAULT_SETTINGS.password;

  it("uses 20 chars with every class present", () => {
    for (let i = 0; i < RUNS; i++) {
      const value = generatePassword(defaults);
      expect(value).toHaveLength(20);
      expect(has(value, DIGITS)).toBe(true);
      expect(has(value, SYMBOLS)).toBe(true);
      expect(has(value, UPPERCASE)).toBe(true);
      expect(has(value, LOWERCASE)).toBe(true);
    }
  });

  it("excludes disabled classes", () => {
    const options: PasswordOptions = { ...defaults, length: 16, symbols: false, numbers: false };

    for (let i = 0; i < RUNS; i++) {
      const value = generatePassword(options);
      expect(has(value, SYMBOLS)).toBe(false);
      expect(has(value, DIGITS)).toBe(false);
      expect(value).toMatch(/^[A-Za-z]{16}$/);
    }
  });

  it("enforces a minimum length of 8", () => {
    expect(() => generatePassword({ ...defaults, length: 7 })).toThrow(GenerationError);
    expect(generatePassword({ ...defaults, length: 8 })).toHaveLength(8);
  });

  it("requires at least one class", () => {
    expect(() =>
      generatePassword({ length: 20, numbers: false, symbols: false, uppercase: false, lowercase: false }),
    ).toThrow(/at least one/);
  });
});

describe("generatePassphrase", () => {
  const defaults = DEFAULT_SETTINGS.passphrase;

  it("uses 3 lowercase words, 5-8 chars, joined by -", () => {
    for (let i = 0; i < RUNS; i++) {
      const words = generatePassphrase(defaults, EFF).split("-");
      expect(words).toHaveLength(3);
      expect(new Set(words).size).toBe(3);

      for (const word of words) {
        expect(word).toMatch(/^[a-z]{5,8}$/);
      }
    }
  });

  it("uppercases exactly the requested number of words", () => {
    const value = generatePassphrase({ ...defaults, words: 5, uppercaseWords: 2, delimiter: "." }, EFF);
    const words = value.split(".");
    expect(words.filter((w) => w === w.toUpperCase())).toHaveLength(2);
  });

  it("supports an empty delimiter and rejects multi-character ones", () => {
    expect(generatePassphrase({ ...defaults, delimiter: "" }, EFF)).toMatch(/^[a-z]+$/);
    expect(() => generatePassphrase({ ...defaults, delimiter: "--" }, EFF)).toThrow(/single character/);
  });

  it("errors when the pool is too small", () => {
    expect(() => generatePassphrase({ ...defaults, words: 3 }, ["apple", "berry"])).toThrow(/Only 2 words/);
  });

  it("rejects min > max", () => {
    expect(() => generatePassphrase({ ...defaults, minWordLength: 9, maxWordLength: 5 }, EFF)).toThrow(GenerationError);
  });

  it("filters by word length", () => {
    expect(filterWordlist(["a", "abcde", "abcdefghi"], 5, 8)).toEqual(["abcde"]);
  });

  it("drops words containing the delimiter", () => {
    expect(filterWordlist(["yo-yo", "apple"], 1, 10, "-")).toEqual(["apple"]);
    expect(filterWordlist(["yo-yo", "apple"], 1, 10, "")).toEqual(["yo-yo", "apple"]);
  });
});

describe("generatePin", () => {
  it("returns only digits", () => {
    for (let i = 0; i < RUNS; i++) {
      expect(generatePin({ length: 4 })).toMatch(/^\d{4}$/);
    }
  });

  it("rejects zero length", () => {
    expect(() => generatePin({ length: 0 })).toThrow(GenerationError);
  });
});

describe("generate", () => {
  it("returns the requested number of values with entropy", () => {
    const result = generate({ type: "pin", options: { length: 6 } }, 5);
    expect(result.values).toHaveLength(5);
    expect(result.entropyBits).toBeCloseTo(6 * Math.log2(10));
  });

  it("warns on small word pools", () => {
    const result = generate({
      type: "passphrase",
      options: { ...DEFAULT_SETTINGS.passphrase, minWordLength: 3, maxWordLength: 3 },
      wordlist: EFF,
    });
    expect(result.warning).toMatch(/Only \d+ words/);
  });
});

describe("settings", () => {
  it("falls back to defaults for empty preferences", () => {
    expect(parsePreferences({})).toEqual({ ...DEFAULT_SETTINGS, customWordlist: undefined });
  });

  it("rejects non-numeric preferences", () => {
    expect(() => parsePreferences({ passwordLength: "twenty" })).toThrow(/Password Length/);
  });

  it("parses clipboard preferences", () => {
    expect(
      parsePreferences({ clearClipboardAfter: "0", universalClipboard: true, concealClipboard: false }).clipboard,
    ).toEqual({ universal: true, concealed: false, clearAfterSeconds: 0 });
    expect(parsePreferences({}).clipboard).toEqual({ universal: false, concealed: true, clearAfterSeconds: 90 });
  });

  it("merges overrides per type without touching other types", () => {
    const settings = applyOverrides(DEFAULT_SETTINGS, { password: { symbols: false }, pin: { length: 6 } });
    expect(settings.password).toEqual({ ...DEFAULT_SETTINGS.password, symbols: false });
    expect(settings.pin.length).toBe(6);
    expect(settings.passphrase).toEqual(DEFAULT_SETTINGS.passphrase);
  });

  it("does not mutate its inputs", () => {
    const overrides = { password: { length: 30 } };
    applyOverrides(DEFAULT_SETTINGS, overrides);
    expect(DEFAULT_SETTINGS.password.length).toBe(20);
    expect(overrides).toEqual({ password: { length: 30 } });
  });

  it("maps size to the right option for each type", () => {
    expect(sizeOverride("password", 30)).toEqual({ password: { length: 30 } });
    expect(sizeOverride("passphrase", 5)).toEqual({ passphrase: { words: 5 } });
    expect(sizeOverride("pin", 6)).toEqual({ pin: { length: 6 } });
    expect(sizeOf(DEFAULT_SETTINGS, "passphrase")).toBe(3);
  });
});

describe("sanitizeOverrides", () => {
  it("keeps known, well-typed fields", () => {
    const input = { password: { length: 30, symbols: false }, passphrase: { delimiter: "" }, pin: { length: 6 } };
    expect(sanitizeOverrides(input)).toEqual(input);
  });

  it("drops unknown keys and wrong types", () => {
    expect(
      sanitizeOverrides({
        password: { length: "30", symbols: "no", extra: 1 },
        passphrase: { delimiter: "ab", words: -1, uppercaseWords: 1.5 },
        pin: { length: 6 },
        other: { length: 1 },
      }),
    ).toEqual({ pin: { length: 6 } });
  });

  it("returns nothing for non-object input", () => {
    for (const input of [null, undefined, "x", 3, [], { password: [] }]) {
      expect(sanitizeOverrides(input)).toEqual({});
    }
  });
});

describe("parseStoredState", () => {
  it("restores a saved state", () => {
    const saved = JSON.stringify({ type: "pin", overrides: { pin: { length: 8 } } });
    expect(parseStoredState(saved, "password")).toEqual({ type: "pin", overrides: { pin: { length: 8 } } });
  });

  it("falls back on missing or corrupt data", () => {
    const empty = { type: "passphrase", overrides: {} };
    expect(parseStoredState(undefined, "passphrase")).toEqual(empty);
    expect(parseStoredState("{not json", "passphrase")).toEqual(empty);
    expect(parseStoredState(JSON.stringify({ type: "bogus" }), "passphrase")).toEqual(empty);
  });
});

describe("parseWordlist", () => {
  it("strips CRLF, blanks, whitespace-containing lines, and duplicates", () => {
    expect(parseWordlist("apple\r\nberry\n\n two words\napple\n")).toEqual(["apple", "berry"]);
  });

  it("loads the embedded EFF list", () => {
    expect(EFF).toHaveLength(7776);
  });
});
