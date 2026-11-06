import type { ClipboardOptions } from "./clipboard";
import { GenerationError, GeneratorType, PassphraseOptions, PasswordOptions, PinOptions } from "./generate";

/** Raw extension preference values, as Raycast provides them. */
export interface RawPreferences {
  defaultType?: string;
  primaryAction?: string;
  passwordLength?: string;
  includeNumbers?: boolean;
  includeSymbols?: boolean;
  includeUppercase?: boolean;
  includeLowercase?: boolean;
  passphraseWords?: string;
  passphraseDelimiter?: string;
  minWordLength?: string;
  maxWordLength?: string;
  uppercaseWords?: string;
  customWordlist?: string;
  pinLength?: string;
  clearClipboardAfter?: string;
  universalClipboard?: boolean;
  concealClipboard?: boolean;
}

export type PrimaryAction = "copy" | "paste";

export interface Settings {
  type: GeneratorType;
  primaryAction: PrimaryAction;
  password: PasswordOptions;
  passphrase: PassphraseOptions;
  pin: PinOptions;
  clipboard: ClipboardOptions;
  customWordlist?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  type: "password",
  primaryAction: "copy",
  password: { length: 20, numbers: true, symbols: true, uppercase: true, lowercase: true },
  passphrase: { words: 3, delimiter: "-", minWordLength: 5, maxWordLength: 8, uppercaseWords: 0 },
  pin: { length: 4 },
  clipboard: { universal: false, concealed: true, clearAfterSeconds: 90 },
};

const GENERATOR_TYPES: readonly GeneratorType[] = ["password", "passphrase", "pin"];

export function isGeneratorType(value: unknown): value is GeneratorType {
  return GENERATOR_TYPES.includes(value as GeneratorType);
}

export function parseInteger(label: string, value: string | undefined, fallback: number): number {
  const trimmed = value?.trim() ?? "";

  if (trimmed === "") {
    return fallback;
  }

  if (!/^\d+$/.test(trimmed)) {
    throw new GenerationError(`${label} must be a whole number, got "${trimmed}"`);
  }

  return Number(trimmed);
}

export function parsePreferences(prefs: RawPreferences): Settings {
  const d = DEFAULT_SETTINGS;

  return {
    type: isGeneratorType(prefs.defaultType) ? prefs.defaultType : d.type,
    primaryAction: prefs.primaryAction === "paste" ? "paste" : "copy",
    password: {
      length: parseInteger("Password Length preference", prefs.passwordLength, d.password.length),
      numbers: prefs.includeNumbers ?? d.password.numbers,
      symbols: prefs.includeSymbols ?? d.password.symbols,
      uppercase: prefs.includeUppercase ?? d.password.uppercase,
      lowercase: prefs.includeLowercase ?? d.password.lowercase,
    },
    passphrase: {
      words: parseInteger("Passphrase Words preference", prefs.passphraseWords, d.passphrase.words),
      delimiter: prefs.passphraseDelimiter ?? d.passphrase.delimiter,
      minWordLength: parseInteger("Minimum Word Length preference", prefs.minWordLength, d.passphrase.minWordLength),
      maxWordLength: parseInteger("Maximum Word Length preference", prefs.maxWordLength, d.passphrase.maxWordLength),
      uppercaseWords: parseInteger("Uppercase Words preference", prefs.uppercaseWords, d.passphrase.uppercaseWords),
    },
    pin: { length: parseInteger("PIN Length preference", prefs.pinLength, d.pin.length) },
    clipboard: {
      universal: prefs.universalClipboard ?? d.clipboard.universal,
      concealed: prefs.concealClipboard ?? d.clipboard.concealed,
      clearAfterSeconds: parseInteger(
        "Clear Clipboard preference",
        prefs.clearClipboardAfter,
        d.clipboard.clearAfterSeconds,
      ),
    },
    customWordlist: prefs.customWordlist?.trim() || undefined,
  };
}

/** Per-run tweaks layered on top of preferences, grouped by generator type. */
export interface Overrides {
  password?: Partial<PasswordOptions>;
  passphrase?: Partial<PassphraseOptions>;
  pin?: Partial<PinOptions>;
}

/** Applies overrides on top of settings without mutating either. */
export function applyOverrides(settings: Settings, overrides: Overrides): Settings {
  return {
    ...settings,
    password: { ...settings.password, ...overrides.password },
    passphrase: { ...settings.passphrase, ...overrides.passphrase },
    pin: { ...settings.pin, ...overrides.pin },
  };
}

type FieldKind = "integer" | "boolean" | "string";

const OVERRIDE_SCHEMA: { [K in keyof Overrides]-?: Record<string, FieldKind> } = {
  password: { length: "integer", numbers: "boolean", symbols: "boolean", uppercase: "boolean", lowercase: "boolean" },
  passphrase: {
    words: "integer",
    delimiter: "string",
    minWordLength: "integer",
    maxWordLength: "integer",
    uppercaseWords: "integer",
  },
  pin: { length: "integer" },
};

function isValidField(kind: FieldKind, value: unknown): boolean {
  switch (kind) {
    case "integer":
      return Number.isSafeInteger(value) && (value as number) >= 0;
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string" && [...value].length <= 1;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Keeps only known, well-typed fields from untrusted data (e.g. LocalStorage).
 * Range checks are left to the generator so errors surface to the user.
 */
export function sanitizeOverrides(raw: unknown): Overrides {
  const result: Record<string, Record<string, unknown>> = {};

  if (!isRecord(raw)) {
    return {};
  }

  for (const [group, fields] of Object.entries(OVERRIDE_SCHEMA)) {
    const input = raw[group];

    if (!isRecord(input)) {
      continue;
    }

    const clean: Record<string, unknown> = {};

    for (const [key, kind] of Object.entries(fields)) {
      if (Object.hasOwn(input, key) && isValidField(kind, input[key])) {
        clean[key] = input[key];
      }
    }

    if (Object.keys(clean).length > 0) {
      result[group] = clean;
    }
  }

  return result as Overrides;
}

/** The option that a bare number adjusts for each type. */
export function sizeOverride(type: GeneratorType, size: number): Overrides {
  switch (type) {
    case "password":
      return { password: { length: size } };
    case "passphrase":
      return { passphrase: { words: size } };
    case "pin":
      return { pin: { length: size } };
  }
}

export function sizeOf(settings: Settings, type: GeneratorType = settings.type): number {
  switch (type) {
    case "password":
      return settings.password.length;
    case "passphrase":
      return settings.passphrase.words;
    case "pin":
      return settings.pin.length;
  }
}

export interface GeneratorState {
  type: GeneratorType;
  overrides: Overrides;
}

/** Parses stored JSON defensively; anything unexpected falls back to defaults. */
export function parseStoredState(raw: unknown, fallbackType: GeneratorType): GeneratorState {
  let data: unknown;

  try {
    data = typeof raw === "string" ? JSON.parse(raw) : undefined;
  } catch {
    data = undefined;
  }

  const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};

  return {
    type: isGeneratorType(record.type) ? record.type : fallbackType,
    overrides: sanitizeOverrides(record.overrides),
  };
}
