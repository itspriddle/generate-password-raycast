import { spawn } from "node:child_process";
import { GenerationError } from "./generate";

export interface ClipboardOptions {
  /** Allow Handoff to sync the value to nearby devices via Universal Clipboard. */
  universal: boolean;
  /** Mark the value concealed so clipboard managers (including Raycast's history) skip it. */
  concealed: boolean;
  /** Clear the clipboard after this many seconds if it still holds our value; 0 disables. */
  clearAfterSeconds: number;
}

/**
 * Writes stdin to the general pasteboard, current-host-only unless argv[0] is "1",
 * and marked concealed (nspasteboard.org) when argv[1] is "1".
 * Prints the resulting changeCount.
 */
const COPY_SCRIPT = `
ObjC.import("AppKit");
function run(argv) {
  const data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  const value = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
  if (!value || Number(value.length) === 0) throw new Error("no input on stdin");
  const pb = $.NSPasteboard.generalPasteboard;
  pb.prepareForNewContentsWithOptions(argv[0] === "1" ? 0 : 1);
  if (!pb.setStringForType(value, "public.utf8-plain-text")) throw new Error("write failed");
  if (argv[1] === "1") pb.setStringForType($(""), "org.nspasteboard.ConcealedType");
  return String(pb.changeCount);
}
`;

/**
 * Waits argv[1] seconds, then clears the pasteboard only if nothing else has
 * been copied since (changeCount still equals argv[0]).
 */
const CLEAR_SCRIPT = `
ObjC.import("AppKit");
function run(argv) {
  delay(Number(argv[1]));
  const pb = $.NSPasteboard.generalPasteboard;
  if (Number(pb.changeCount) === Number(argv[0])) pb.clearContents;
}
`;

/**
 * Uses `spawn` rather than `execFile`: some Raycast-compatible hosts (e.g. Tinycast)
 * don't expose stdin on `execFile`, which would silently write an empty clipboard.
 */
function writePasteboard(value: string, { universal, concealed }: ClipboardOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    const fail = (cause: unknown) => {
      console.error(cause);
      reject(new GenerationError("Could not write to the clipboard"));
    };

    const child = spawn(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", COPY_SCRIPT, universal ? "1" : "0", concealed ? "1" : "0"],
      { timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer | string) => (stdout += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer | string) => (stderr += chunk.toString()));
    child.on("error", fail);
    child.on("close", (code) => {
      const count = Number(stdout.trim());
      if (code !== 0 || stdout.trim() === "" || !Number.isSafeInteger(count)) {
        fail(new Error(`osascript exited with ${code}: ${stderr.trim()}`));
      } else {
        resolve(count);
      }
    });

    // The secret goes over stdin so it never appears in process arguments.
    if (!child.stdin) {
      child.kill();
      fail(new Error("osascript stdin unavailable"));
      return;
    }
    child.stdin.end(value);
  });
}

/** Starts a detached timer that outlives the extension process. */
function scheduleClear(changeCount: number, seconds: number): void {
  const child = spawn(
    "/usr/bin/osascript",
    ["-l", "JavaScript", "-e", CLEAR_SCRIPT, String(changeCount), String(seconds)],
    { detached: true, stdio: "ignore" },
  );

  child.on("error", (error) => console.error(error));
  child.unref();
}

/** Copies a secret to the clipboard, honoring Universal Clipboard and auto-clear settings. */
export async function copySecret(value: string, options: ClipboardOptions): Promise<void> {
  const changeCount = await writePasteboard(value, options);

  if (options.clearAfterSeconds > 0) {
    scheduleClear(changeCount, options.clearAfterSeconds);
  }
}
