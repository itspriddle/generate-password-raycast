import { environment, getPreferenceValues } from "@raycast/api";
import { join } from "node:path";
import { GeneratorSpec } from "./generate";
import { parsePreferences, RawPreferences, Settings } from "./options";
import { readWordlist } from "./wordlist";

export const TYPE_LABELS = { password: "Password", passphrase: "Passphrase", pin: "PIN" } as const;

export function loadSettings(): Settings {
  return parsePreferences(getPreferenceValues<RawPreferences>());
}

/** Builds a generator spec, loading the word list only for passphrases. */
export function buildSpec(settings: Settings): GeneratorSpec {
  switch (settings.type) {
    case "password":
      return { type: "password", options: settings.password };
    case "passphrase": {
      const path = settings.customWordlist ?? join(environment.assetsPath, "eff_large_wordlist.txt");
      return { type: "passphrase", options: settings.passphrase, wordlist: readWordlist(path) };
    }
    case "pin":
      return { type: "pin", options: settings.pin };
  }
}
