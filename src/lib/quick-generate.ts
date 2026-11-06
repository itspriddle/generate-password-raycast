import { Clipboard, closeMainWindow, showHUD, showToast, Toast } from "@raycast/api";
import { copySecret } from "./clipboard";
import { generate, GenerationError, GeneratorType } from "./generate";
import { applyOverrides, parseInteger, sizeOf, sizeOverride } from "./options";
import { buildSpec, loadSettings, TYPE_LABELS } from "./raycast";

const SIZE_LABELS: Record<GeneratorType, string> = { password: "Length", passphrase: "Words", pin: "Digits" };

/** Generates one value of `type`, optionally resized, then copies or pastes it. */
export async function quickGenerate(type: GeneratorType, size?: string): Promise<void> {
  try {
    const settings = { ...loadSettings(), type };
    const resolved = applyOverrides(
      settings,
      sizeOverride(type, parseInteger(SIZE_LABELS[type], size, sizeOf(settings))),
    );
    const [value] = generate(buildSpec(resolved)).values;

    if (resolved.primaryAction === "paste") {
      await closeMainWindow();
      await Clipboard.paste(value);
    } else {
      await copySecret(value, resolved.clipboard);
      await showHUD(`Copied ${TYPE_LABELS[type]} to Clipboard`);
    }
  } catch (error) {
    await showToast({
      style: Toast.Style.Failure,
      title: `Could not generate ${TYPE_LABELS[type].toLowerCase()}`,
      message: error instanceof GenerationError ? error.message : "Unexpected error",
    });

    if (!(error instanceof GenerationError)) {
      console.error(error);
    }
  }
}
