import {
  Action,
  ActionPanel,
  Color,
  Icon,
  Keyboard,
  List,
  openExtensionPreferences,
  showHUD,
  showToast,
  Toast,
} from "@raycast/api";
import { useMemo, useState } from "react";
import {
  generate,
  GenerationError,
  GenerationResult,
  GeneratorType,
  MAX_PASSPHRASE_WORDS,
  MAX_PASSWORD_LENGTH,
  MAX_PIN_LENGTH,
  MIN_PASSWORD_LENGTH,
  PassphraseOptions,
  PasswordOptions,
} from "./lib/generate";
import {
  applyOverrides,
  GeneratorState,
  isGeneratorType,
  Overrides,
  Settings,
  sizeOf,
  sizeOverride,
} from "./lib/options";
import { ClipboardOptions, copySecret } from "./lib/clipboard";
import { buildSpec, loadSettings, TYPE_LABELS } from "./lib/raycast";
import { useGeneratorState } from "./lib/use-generator-state";

const CANDIDATE_COUNT = 5;

const SIZE_NOUN: Record<GeneratorType, string> = { password: "length", passphrase: "word count", pin: "digit count" };
const SIZE_UNIT: Record<GeneratorType, string> = { password: "chars", passphrase: "words", pin: "digits" };
const SIZE_LIMITS: Record<GeneratorType, [number, number]> = {
  password: [MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH],
  passphrase: [1, MAX_PASSPHRASE_WORDS],
  pin: [1, MAX_PIN_LENGTH],
};

const CHARACTER_CLASSES: {
  key: keyof Omit<PasswordOptions, "length">;
  label: string;
  tag: string;
  shortcutKey: "n" | "s" | "u" | "l";
}[] = [
  { key: "numbers", label: "Numbers", tag: "0-9", shortcutKey: "n" },
  { key: "symbols", label: "Symbols", tag: "!@#", shortcutKey: "s" },
  { key: "uppercase", label: "Uppercase", tag: "A-Z", shortcutKey: "u" },
  { key: "lowercase", label: "Lowercase", tag: "a-z", shortcutKey: "l" },
];

const DELIMITERS: { value: string; title: string }[] = [
  { value: "-", title: "Hyphen  -" },
  { value: ".", title: "Period  ." },
  { value: "_", title: "Underscore  _" },
  { value: " ", title: "Space" },
  { value: "", title: "None" },
];

const WORD_LENGTH_RANGES: [number, number][] = [
  [3, 5],
  [4, 6],
  [4, 8],
  [5, 8],
  [6, 10],
];

const MAX_UPPERCASE_WORDS_MENU = 5;

const shortcut = (key: Keyboard.KeyEquivalent, ...modifiers: Keyboard.KeyModifier[]): Keyboard.Shortcut => ({
  modifiers,
  key,
});

type Generated = { ok: true; settings: Settings; result: GenerationResult } | { ok: false; error: string };

function errorMessage(error: unknown): string {
  if (error instanceof GenerationError) {
    return error.message;
  }

  console.error(error);
  return "Unexpected error";
}

/** Wraps the value in a code fence longer than any backtick run it contains. */
function codeBlock(value: string): string {
  const longestRun = Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));

  return `${fence}\n${value}\n${fence}`;
}

function strengthLabel(bits: number): string {
  if (bits < 40) return "Weak";
  if (bits < 64) return "Fair";
  if (bits < 100) return "Strong";
  return "Very Strong";
}

function clamp(value: number, [min, max]: [number, number]): number {
  return Math.min(max, Math.max(min, value));
}

function describeDelimiter(delimiter: string): string {
  if (delimiter === "") return "no separator";
  if (delimiter === " ") return "space separated";
  return `separator ${delimiter}`;
}

/** A bare number in the search bar sets the size; anything else is invalid. */
function parseQuery(query: string): { size?: number; invalid: boolean } {
  const trimmed = query.trim();

  if (trimmed === "") return { invalid: false };
  if (/^\d+$/.test(trimmed)) return { size: Number(trimmed), invalid: false };
  return { invalid: true };
}

export default function Command() {
  const base = useMemo(() => {
    try {
      return { ok: true as const, settings: loadSettings() };
    } catch (error) {
      return { ok: false as const, error: errorMessage(error) };
    }
  }, []);

  const fallbackType = base.ok ? base.settings.type : "password";
  const { state, update, isLoading } = useGeneratorState(fallbackType);
  const [query, setQuery] = useState("");
  const [generation, setGeneration] = useState(0);
  const { type, overrides } = state;
  const parsedQuery = parseQuery(query);

  // Preferences + saved tweaks, before any search-bar size.
  const current = base.ok ? applyOverrides({ ...base.settings, type }, overrides) : undefined;

  const generated = useMemo<Generated>(() => {
    if (!base.ok) {
      return base;
    }

    try {
      if (parsedQuery.invalid) {
        throw new GenerationError(`Type a number to set the ${SIZE_NOUN[type]}`);
      }

      let settings = applyOverrides({ ...base.settings, type }, overrides);

      if (parsedQuery.size !== undefined) {
        settings = applyOverrides(settings, sizeOverride(type, parsedQuery.size));
      }

      return { ok: true, settings, result: generate(buildSpec(settings), CANDIDATE_COUNT) };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
    // `generation` is a dependency so ⌘R produces fresh values.
  }, [base, type, overrides, parsedQuery.size, parsedQuery.invalid, generation]);

  const regenerate = () => setGeneration((n) => n + 1);

  /** Applies a change to the saved tweaks, computed from the latest state. */
  const updateOverrides = (fn: (settings: Settings, state: GeneratorState) => Overrides) => {
    if (!base.ok) return;

    update((s) => {
      const settings = applyOverrides({ ...base.settings, type: s.type }, s.overrides);
      const patch = fn(settings, s);

      return {
        ...s,
        overrides: {
          password: { ...s.overrides.password, ...patch.password },
          passphrase: { ...s.overrides.passphrase, ...patch.passphrase },
          pin: { ...s.overrides.pin, ...patch.pin },
        },
      };
    });
  };

  const adjustSize = (delta: number) => {
    updateOverrides((settings, s) => {
      const start = parsedQuery.size ?? sizeOf(settings, s.type);
      return sizeOverride(s.type, clamp(start + delta, SIZE_LIMITS[s.type]));
    });
    setQuery("");
  };

  const setPassphrase = (patch: Partial<PassphraseOptions>) => updateOverrides(() => ({ passphrase: patch }));

  const resetType = () => {
    update((s) => ({ ...s, overrides: { ...s.overrides, [s.type]: undefined } }));
    setQuery("");
  };

  const changeType = (value: string) => {
    if (isLoading || !isGeneratorType(value) || value === type) return;
    update((s) => ({ ...s, type: value }));
    setQuery("");
  };

  const hasOverrides = Object.keys(overrides[type] ?? {}).length > 0;

  const optionActions = current && (
    <>
      <ActionPanel.Section title="Options">
        <Action
          title={`Increase ${TYPE_LABELS[type]} Size`}
          icon={Icon.Plus}
          shortcut={shortcut("arrowUp", "opt")}
          onAction={() => adjustSize(1)}
        />
        <Action
          title={`Decrease ${TYPE_LABELS[type]} Size`}
          icon={Icon.Minus}
          shortcut={shortcut("arrowDown", "opt")}
          onAction={() => adjustSize(-1)}
        />
        {type === "password" &&
          CHARACTER_CLASSES.map(({ key, label, shortcutKey }) => {
            const enabled = current.password[key];
            return (
              <Action
                key={key}
                title={`${enabled ? "Exclude" : "Include"} ${label}`}
                icon={enabled ? Icon.CheckCircle : Icon.Circle}
                shortcut={shortcut(shortcutKey, "opt")}
                onAction={() => updateOverrides((settings) => ({ password: { [key]: !settings.password[key] } }))}
              />
            );
          })}
        {type === "passphrase" && (
          <>
            <ActionPanel.Submenu title="Separator" icon={Icon.Minus} shortcut={shortcut("d", "opt")}>
              {DELIMITERS.map(({ value, title }) => (
                <Action
                  key={title}
                  title={title}
                  icon={current.passphrase.delimiter === value ? Icon.Checkmark : undefined}
                  onAction={() => setPassphrase({ delimiter: value })}
                />
              ))}
            </ActionPanel.Submenu>
            <ActionPanel.Submenu title="Uppercase Words" icon={Icon.Text} shortcut={shortcut("u", "opt")}>
              {Array.from({ length: Math.min(current.passphrase.words, MAX_UPPERCASE_WORDS_MENU) + 1 }, (_, n) => (
                <Action
                  key={n}
                  title={n === 0 ? "None" : `${n}`}
                  icon={current.passphrase.uppercaseWords === n ? Icon.Checkmark : undefined}
                  onAction={() => setPassphrase({ uppercaseWords: n })}
                />
              ))}
            </ActionPanel.Submenu>
            <ActionPanel.Submenu title="Word Length" icon={Icon.Ruler} shortcut={shortcut("w", "opt")}>
              {WORD_LENGTH_RANGES.map(([min, max]) => (
                <Action
                  key={`${min}-${max}`}
                  title={`${min}–${max} Letters`}
                  icon={
                    current.passphrase.minWordLength === min && current.passphrase.maxWordLength === max
                      ? Icon.Checkmark
                      : undefined
                  }
                  onAction={() => setPassphrase({ minWordLength: min, maxWordLength: max })}
                />
              ))}
            </ActionPanel.Submenu>
          </>
        )}
        {hasOverrides && (
          <Action
            title="Reset to Preferences"
            icon={Icon.RotateAntiClockwise}
            shortcut={shortcut("backspace", "cmd", "shift")}
            onAction={resetType}
          />
        )}
      </ActionPanel.Section>
    </>
  );

  const sharedActions = (
    <ActionPanel.Section>
      <Action
        title="Regenerate"
        icon={Icon.ArrowClockwise}
        shortcut={Keyboard.Shortcut.Common.Refresh}
        onAction={regenerate}
      />
      <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
    </ActionPanel.Section>
  );

  const placeholder = current
    ? `${TYPE_LABELS[type]} ${SIZE_NOUN[type]}: ${sizeOf(current)} (type a number, or ⌥↑ / ⌥↓)`
    : "Generate";

  return (
    <List
      isLoading={isLoading}
      filtering={false}
      searchText={query}
      onSearchTextChange={setQuery}
      searchBarPlaceholder={placeholder}
      isShowingDetail={!isLoading && generated.ok}
      searchBarAccessory={
        <List.Dropdown tooltip="Type" value={type} onChange={changeType}>
          {(Object.keys(TYPE_LABELS) as GeneratorType[]).map((key) => (
            <List.Dropdown.Item key={key} title={TYPE_LABELS[key]} value={key} />
          ))}
        </List.Dropdown>
      }
    >
      {isLoading ? null : generated.ok ? (
        generated.result.values.map((value, index) => {
          const { settings, result } = generated;
          const bits = Math.floor(result.entropyBits);
          const primary =
            settings.primaryAction === "paste" ? (
              <Action.Paste title="Paste" content={value} />
            ) : (
              <CopySecretAction title="Copy" content={value} options={settings.clipboard} />
            );
          const secondary =
            settings.primaryAction === "paste" ? (
              <CopySecretAction title="Copy" content={value} options={settings.clipboard} />
            ) : (
              <Action.Paste title="Paste" content={value} />
            );

          return (
            <List.Item
              key={`${generation}-${index}`}
              title={value}
              detail={
                <List.Item.Detail
                  markdown={codeBlock(value)}
                  metadata={
                    <List.Item.Detail.Metadata>
                      <List.Item.Detail.Metadata.Label title="Type" text={TYPE_LABELS[settings.type]} />
                      <List.Item.Detail.Metadata.Label title="Length" text={`${[...value].length} characters`} />
                      <List.Item.Detail.Metadata.Label
                        title="Entropy"
                        text={`~${bits} bits (${strengthLabel(result.entropyBits)})`}
                      />
                      {result.warning && (
                        <List.Item.Detail.Metadata.Label title="Warning" text={result.warning} icon={Icon.Warning} />
                      )}
                      <List.Item.Detail.Metadata.Separator />
                      <SettingsTags settings={settings} defaults={base.ok ? base.settings : settings} />
                    </List.Item.Detail.Metadata>
                  }
                />
              }
              actions={
                <ActionPanel>
                  <ActionPanel.Section>
                    {primary}
                    {secondary}
                    <CopySecretAction
                      title="Copy All"
                      content={result.values.join("\n")}
                      options={settings.clipboard}
                      shortcut={Keyboard.Shortcut.Common.Copy}
                    />
                  </ActionPanel.Section>
                  {optionActions}
                  {sharedActions}
                </ActionPanel>
              }
            />
          );
        })
      ) : (
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title={generated.error}
          description={hasOverrides ? "Adjust the options, or reset to your preferences (⌘⇧⌫)" : undefined}
          actions={
            <ActionPanel>
              {optionActions}
              {sharedActions}
            </ActionPanel>
          }
        />
      )}
    </List>
  );
}

/** Current options as tags; values that differ from preferences are highlighted. */
function SettingsTags({ settings, defaults }: { settings: Settings; defaults: Settings }) {
  const color = (changed: boolean) => (changed ? Color.Blue : undefined);
  const { type } = settings;
  const size = sizeOf(settings);
  const sizeTag = (
    <List.Item.Detail.Metadata.TagList.Item
      text={`${size} ${SIZE_UNIT[type]}`}
      color={color(size !== sizeOf(defaults, type))}
    />
  );

  if (type === "password") {
    return (
      <List.Item.Detail.Metadata.TagList title="Options">
        {sizeTag}
        {CHARACTER_CLASSES.filter(({ key }) => settings.password[key]).map(({ key, tag }) => (
          <List.Item.Detail.Metadata.TagList.Item
            key={key}
            text={tag}
            color={color(settings.password[key] !== defaults.password[key])}
          />
        ))}
      </List.Item.Detail.Metadata.TagList>
    );
  }

  if (type === "passphrase") {
    const p = settings.passphrase;
    const d = defaults.passphrase;

    return (
      <List.Item.Detail.Metadata.TagList title="Options">
        {sizeTag}
        <List.Item.Detail.Metadata.TagList.Item
          text={describeDelimiter(p.delimiter)}
          color={color(p.delimiter !== d.delimiter)}
        />
        <List.Item.Detail.Metadata.TagList.Item
          text={`${p.minWordLength}–${p.maxWordLength} letters`}
          color={color(p.minWordLength !== d.minWordLength || p.maxWordLength !== d.maxWordLength)}
        />
        {p.uppercaseWords > 0 && (
          <List.Item.Detail.Metadata.TagList.Item
            text={`${p.uppercaseWords} UPPERCASE`}
            color={color(p.uppercaseWords !== d.uppercaseWords)}
          />
        )}
      </List.Item.Detail.Metadata.TagList>
    );
  }

  return <List.Item.Detail.Metadata.TagList title="Options">{sizeTag}</List.Item.Detail.Metadata.TagList>;
}

/** Copies via `copySecret` so Universal Clipboard and auto-clear preferences apply. */
function CopySecretAction(props: {
  title: string;
  content: string;
  options: ClipboardOptions;
  shortcut?: Keyboard.Shortcut;
}) {
  const copy = async () => {
    try {
      await copySecret(props.content, props.options);
      await showHUD("Copied to Clipboard");
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: errorMessage(error) });
    }
  };

  return <Action title={props.title} icon={Icon.Clipboard} shortcut={props.shortcut} onAction={copy} />;
}
