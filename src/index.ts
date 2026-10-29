/**
 * clidoc library API. Nothing here reads `process.argv` or calls
 * `process.exit` — that lives in ./cli.ts — so every function below can be
 * imported and driven from another tool.
 */
import path from "node:path";

import { normalizeOutput } from "./normalize.js";
import { PINNED_ENV, runAndCapture } from "./record.js";
import { deriveId, writeSnapshot } from "./store.js";
import type { NormalizeOptions } from "./normalize.js";
import type { Snapshot } from "./types.js";

export { ClidocError } from "./errors.js";
export type { ClidocErrorCode } from "./errors.js";

export { buildEnv, formatCommand, runAndCapture, PINNED_ENV, SCRUBBED_ENV } from "./record.js";
export type { BuildEnvOptions, CaptureOptions } from "./record.js";

export { normalizeOutput, NORMALIZER_NAMES } from "./normalize.js";
export type {
  NormalizeChange,
  NormalizeOptions,
  NormalizeResult,
  NormalizerName,
} from "./normalize.js";

export {
  assertValidId,
  deriveId,
  listSnapshots,
  readAllSnapshots,
  readSnapshot,
  snapshotPath,
  writeSnapshot,
  SNAPSHOT_DIR,
} from "./store.js";

export {
  fencedLineMask,
  findBlocks,
  firstDifference,
  readBlockBody,
  replaceBlocks,
} from "./markdown.js";
export type { ReplaceBlocksOptions } from "./markdown.js";

export {
  DEFAULT_MAX_LINES,
  DEFAULT_README,
  renderBlocks,
  renderReadme,
  renderSnapshot,
} from "./render.js";
export type { RenderOptions, RenderReadmeOptions, RenderReadmeResult } from "./render.js";

export type { CaptureResult, MarkdownBlock, ReplaceBlocksResult, Snapshot } from "./types.js";

export interface CreateSnapshotOptions {
  /** Project root; snapshots land in `<root>/.clidoc/`. */
  root: string;
  /** Command to run. */
  argv: string[];
  /** Snapshot id; derived from the command when omitted. */
  id?: string;
  /** Directory to run the command in. Defaults to `root`. */
  cwd?: string;
  /** Milliseconds before the child is killed. Defaults to 15000. */
  timeoutMs?: number;
  /** Extra environment variables for the child. */
  env?: Record<string, string>;
  /** Disable parts of the normaliser chain. */
  normalize?: NormalizeOptions | false;
  /** Keep `stdoutRaw`/`stderrRaw` in the snapshot file. Defaults to true. */
  keepRaw?: boolean;
  /** Store duration and timestamp in the snapshot. Defaults to false. */
  stamp?: boolean;
}

/** Runs a command, normalises its output and writes `.clidoc/<id>.json`. */
export async function createSnapshot(options: CreateSnapshotOptions): Promise<Snapshot> {
  const root = path.resolve(options.root);
  const id = options.id ?? deriveId(options.argv);

  const capture = await runAndCapture({
    argv: options.argv,
    cwd: options.cwd ?? root,
    timeoutMs: options.timeoutMs,
    env: options.env,
  });

  const normalizeOptions: NormalizeOptions =
    options.normalize === false
      ? { enabled: false }
      : { cwd: capture.cwd, ...(options.normalize ?? {}) };

  const snapshot: Snapshot = {
    version: 1,
    id,
    command: capture.command,
    argv: capture.argv,
    cwd: ".",
    exitCode: capture.exitCode,
    signal: capture.signal,
    timedOut: capture.timedOut,
    stdout: normalizeOutput(capture.stdout, normalizeOptions).text,
    stderr: normalizeOutput(capture.stderr, normalizeOptions).text,
    env: { ...PINNED_ENV },
  };

  if (options.keepRaw !== false) {
    snapshot.stdoutRaw = capture.stdout;
    snapshot.stderrRaw = capture.stderr;
  }
  if (options.stamp) {
    snapshot.durationMs = capture.durationMs;
    snapshot.recordedAt = new Date().toISOString();
  }

  await writeSnapshot(root, snapshot);
  return snapshot;
}
