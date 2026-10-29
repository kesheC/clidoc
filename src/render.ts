import fs from "node:fs/promises";
import path from "node:path";

import { ClidocError } from "./errors.js";
import { firstDifference, replaceBlocks } from "./markdown.js";
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
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
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

  const lines = [`$ ${snapshot.command}`, "```console", ...body, "```"];
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
