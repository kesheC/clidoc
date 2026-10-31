import fs from "node:fs/promises";
import path from "node:path";

import { ClidocError } from "./errors.js";
import { findBlocks, firstDifference, replaceBlocks } from "./markdown.js";
import type { Snapshot } from "./types.js";

export const DEFAULT_MAX_LINES = 40;
export const DEFAULT_README = "README.md";

export interface RenderOptions {
  /** Maximum output lines kept before the truncation notice. Defaults to 40. */
  maxLines?: number;
  /** Merge stderr after stdout, like a terminal would. Defaults to true. */
  includeStderr?: boolean;
  /** Append `[exit code: N]` when the command failed. Defaults to true. */
  showExitCode?: boolean;
}

/**
 * A snapshot's stdout is untrusted text. If it happens to contain clidoc's own
 * marker syntax, rendering it verbatim would create a second (ghost) block that
 * clidoc then refuses to parse. Breaking the `<!--` opener keeps the visible
 * text identical in HTML while making the line inert to the marker parser.
 */
function escapeMarkers(line: string): string {
  return line.replace(/<!--(?=\s*clidoc:)/g, "&lt;!--");
}

/** Longest run of backticks anywhere in the body, so the fence can outrun it. */
function longestBacktickRun(lines: readonly string[]): number {
  let longest = 0;
  for (const line of lines) {
    for (const run of line.match(/`+/g) ?? []) {
      if (run.length > longest) longest = run.length;
    }
  }
  return longest;
}

function truncate(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const hidden = lines.length - maxLines;
  kept.push(`... (${hidden} more line${hidden === 1 ? "" : "s"})`);
  return kept;
}

/**
 * Renders one snapshot as the markdown that lives between its README markers:
 * a `$ command` line followed by a fenced `console` block.
 */
export function renderSnapshot(snapshot: Snapshot, options: RenderOptions = {}): string {
  // A snapshot may pin the width it was recorded with; that beats both the
  // caller's flag and the default so `run --max-lines` and `render --check`
  // can never disagree.
  const maxLines = snapshot.maxLines ?? options.maxLines ?? DEFAULT_MAX_LINES;
  if (!Number.isInteger(maxLines) || maxLines <= 0) {
    throw new ClidocError("usage", `--max-lines must be a positive integer, got ${maxLines}.`);
  }
  const includeStderr = options.includeStderr ?? true;
  const showExitCode = options.showExitCode ?? true;

  const parts: string[] = [];
  const stdout = snapshot.stdout.replace(/\n$/, "");
  const stderr = snapshot.stderr.replace(/\n$/, "");
  if (stdout.length > 0) parts.push(stdout);
  if (includeStderr && stderr.length > 0) parts.push(stderr);

  const body = parts.length > 0 ? truncate(parts.join("\n").split("\n"), maxLines) : [];
  const failed = snapshot.exitCode !== 0 || snapshot.signal !== null;
  if (failed && showExitCode) {
    body.push(
      snapshot.signal !== null
        ? `[killed by ${snapshot.signal}]`
        : `[exit code: ${snapshot.exitCode ?? "null"}]`,
    );
  }

  const safeBody = body.map(escapeMarkers);
  // The fence must be longer than any backtick run in the body, otherwise a
  // body line made of backticks closes the block early and silently shreds
  // every marker that follows it.
  const fence = "`".repeat(Math.max(3, longestBacktickRun(safeBody) + 1));
  const lines = [`$ ${escapeMarkers(snapshot.command)}`, `${fence}console`, ...safeBody, fence];
  return lines.join("\n");
}

/** Renders every snapshot into an id → markdown body map. */
export function renderBlocks(
  snapshots: readonly Snapshot[],
  options: RenderOptions = {},
): Map<string, string> {
  const bodies = new Map<string, string>();
  for (const snapshot of snapshots) {
    if (bodies.has(snapshot.id)) {
      throw new ClidocError("snapshot", `Duplicate snapshot id "${snapshot.id}".`);
    }
    bodies.set(snapshot.id, renderSnapshot(snapshot, options));
  }
  return bodies;
}

/**
 * Re-parses freshly rendered markdown with our own parser. A block whose body
 * escapes its fence can leave a marker pair nested inside the outer one, which
 * turns the README into something `clidoc render` refuses to read afterwards.
 * Catching it here means a broken render fails loudly instead of being written.
 */
export function assertSelfParseable(markdown: string, ids: readonly string[]): void {
  try {
    findBlocks(markdown);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ClidocError(
      "markdown",
      "Refusing to write a README this tool cannot read back " +
        `(${ids.join(", ")}): ${detail} ` +
        "The command output escapes its code fence or contains marker syntax.",
    );
  }
}

export interface RenderReadmeOptions extends RenderOptions {
  /** Project root that contains the README and `.clidoc/`. */
  root: string;
  /** README path, relative to `root` (or absolute). Defaults to README.md. */
  readme?: string;
  /** When true nothing is written, only compared. */
  check?: boolean;
  /** Downgrade "snapshot without marker" / "marker without snapshot" to warnings. */
  allowMissing?: boolean;
}

export interface RenderReadmeResult {
  readmePath: string;
  /** True when the file on disk differs from what would be written. */
  changed: boolean;
  /** Ids whose body was written (or would be, in check mode). */
  rendered: string[];
  /** Snapshot ids with no matching marker pair. */
  missing: string[];
  /** Marker ids with no matching snapshot. */
  unmatched: string[];
  /** The would-be README contents. */
  markdown: string;
  /** Human readable first difference found in check mode, if any. */
  difference: string | null;
}

/** Renders all snapshots into the README markers, optionally in check mode. */
export async function renderReadme(
  snapshots: readonly Snapshot[],
  options: RenderReadmeOptions,
): Promise<RenderReadmeResult> {
  const readmePath = path.resolve(options.root, options.readme ?? DEFAULT_README);

  let markdown: string;
  try {
    markdown = await fs.readFile(readmePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ClidocError("io", `README not found: ${readmePath}`);
    }
    throw new ClidocError("io", `Cannot read ${readmePath}: ${(error as Error).message}`);
  }

  // Preserve the README's own line endings. A Windows checkout with
  // core.autocrlf=true hands us CRLF; writing LF back would make the file
  // dirty forever and, worse, make `--check` report a phantom difference.
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  const working = eol === "\n" ? markdown : markdown.replace(/\r\n/g, "\n");

  const bodies = renderBlocks(snapshots, options);
  const result = replaceBlocks(working, bodies);

  const problems: string[] = [];
  if (result.missing.length > 0) {
    problems.push(
      `snapshot(s) with no <!-- clidoc:start --> marker: ${result.missing.join(", ")}`,
    );
  }
  if (result.unmatched.length > 0) {
    problems.push(`marker(s) with no recorded snapshot: ${result.unmatched.join(", ")}`);
  }
  if (problems.length > 0 && !options.allowMissing) {
    throw new ClidocError(
      "markdown",
      `${problems.join("; ")}. Fix the markers or pass --allow-missing.`,
    );
  }

  const nextMarkdown = eol === "\n" ? result.markdown : result.markdown.replace(/\n/g, "\r\n");
  const changed = nextMarkdown !== markdown;

  // Never hand back a document our own parser would choke on.
  assertSelfParseable(result.markdown, result.replaced);

  if (changed && !options.check) {
    await fs.writeFile(readmePath, nextMarkdown, "utf8");
  }

  return {
    readmePath,
    changed,
    rendered: result.replaced,
    missing: result.missing,
    unmatched: result.unmatched,
    markdown: nextMarkdown,
    difference: firstDifference(markdown, nextMarkdown),
  };
}
