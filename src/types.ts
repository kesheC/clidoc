/** Shape of one `.clidoc/<id>.json` file. */
export interface Snapshot {
  /** Schema version of the snapshot file. */
  version: 1;
  /** Stable identifier used by the README markers. */
  id: string;
  /** Human readable command line, shell-quoted for display. */
  command: string;
  /** Raw argv array that was executed (no shell involved). */
  argv: string[];
  /** Working directory, relative to the project root; `.` for the root itself. */
  cwd: string;
  /** Process exit code, or `null` when the child never exited normally. */
  exitCode: number | null;
  /** Signal that terminated the child, if any. */
  signal: string | null;
  /** True when the run was killed because it hit `--timeout`. */
  timedOut: boolean;
  /** Normalised stdout (what gets rendered). */
  stdout: string;
  /** Normalised stderr. */
  stderr: string;
  /** Untouched-but-sanitised stdout, kept for debugging. Omitted with `--no-raw`. */
  stdoutRaw?: string;
  /** Untouched-but-sanitised stderr, kept for debugging. Omitted with `--no-raw`. */
  stderrRaw?: string;
  /** Wall clock duration, only stored with `--stamp` so diffs stay clean. */
  durationMs?: number;
  /** ISO timestamp of the capture, only stored with `--stamp`. */
  recordedAt?: string;
  /** Line budget this snapshot was recorded with; `render` honours it. */
  maxLines?: number;
  /** Fingerprint of the pinned environment variables. */
  env: Record<string, string>;
}

/** Result of spawning a child process (before normalisation). */
export interface CaptureResult {
  argv: string[];
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
}

/** One block of the README delimited by clidoc markers. */
export interface MarkdownBlock {
  id: string;
  /** Zero-based index of the `clidoc:start` line. */
  openLine: number;
  /** Zero-based index of the `clidoc:end` line. */
  closeLine: number;
}

export interface ReplaceBlocksResult {
  markdown: string;
  /** Ids whose body was written. */
  replaced: string[];
  /** Ids that had a rendered body but no marker pair in the README. */
  missing: string[];
  /** Marker ids that had no rendered body (left untouched). */
  unmatched: string[];
}
