import { ClidocError } from "./errors.js";
import type { MarkdownBlock, ReplaceBlocksResult } from "./types.js";

const START = /^<!--\s*clidoc:start\s+([^\s>]+?)\s*-->$/;
const END = /^<!--\s*clidoc:end\s+([^\s>]+?)\s*-->$/;

function markerId(line: string, pattern: RegExp): string | null {
  const match = pattern.exec(line.trim());
  return match?.[1] ?? null;
}

/** True for a line that opens or closes a ``` / `~~~` fenced code block. */
function isFence(line: string): RegExpExecArray | null {
  return /^\s{0,3}(`{3,}|~{3,})/.exec(line);
}

/**
 * Computes which line indexes sit inside a fenced code block. Markers quoted
 * inside a documentation example must not be treated as real markers — the
 * README of clidoc itself shows marker syntax inside a fence.
 */
export function fencedLineMask(markdown: string): boolean[] {
  const lines = markdown.split("\n");
  const mask = new Array<boolean>(lines.length).fill(false);
  let openFence: { char: string; length: number } | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const fence = isFence(line);
    if (openFence === null) {
      if (fence) {
        const char = fence[1]?.[0] ?? "`";
        openFence = { char, length: fence[1]?.length ?? 3 };
        mask[i] = true;
      }
      continue;
    }
    mask[i] = true;
    if (fence && fence[1]?.[0] === openFence.char && (fence[1]?.length ?? 0) >= openFence.length) {
      openFence = null;
    }
  }
  return mask;
}

/**
 * Finds every `clidoc:start <id>` / `clidoc:end <id>` pair in order.
 * Throws when a pair is malformed, unmatched, nested or duplicated: a broken
 * marker is a documentation bug, not something to silently skip.
 */
export function findBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.split("\n");
  const fenced = fencedLineMask(markdown);
  const blocks: MarkdownBlock[] = [];
  const seen = new Set<string>();
  let open: { id: string; line: number } | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    if (fenced[i] === true) continue;
    const line = lines[i] ?? "";
    const startId = markerId(line, START);
    const endId = markerId(line, END);

    if (startId !== null) {
      if (open) {
        throw new ClidocError(
          "markdown",
          `Line ${i + 1}: "clidoc:start ${startId}" opened while "${open.id}" (line ${open.line + 1}) is still open.`,
        );
      }
      if (seen.has(startId)) {
        throw new ClidocError(
          "markdown",
          `Line ${i + 1}: duplicate "clidoc:start ${startId}". Each id may appear once.`,
        );
      }
      open = { id: startId, line: i };
      continue;
    }

    if (endId !== null) {
      if (!open) {
        throw new ClidocError(
          "markdown",
          `Line ${i + 1}: "clidoc:end ${endId}" has no matching "clidoc:start".`,
        );
      }
      if (open.id !== endId) {
        throw new ClidocError(
          "markdown",
          `Line ${i + 1}: "clidoc:end ${endId}" closes "${open.id}" (line ${open.line + 1}).`,
        );
      }
      seen.add(open.id);
      blocks.push({ id: open.id, openLine: open.line, closeLine: i });
      open = null;
    }
  }

  if (open) {
    throw new ClidocError(
      "markdown",
      `"clidoc:start ${open.id}" (line ${open.line + 1}) is never closed.`,
    );
  }
  return blocks;
}

/** Returns the current body between the markers for `id`, without markers. */
export function readBlockBody(markdown: string, id: string): string | null {
  const lines = markdown.split("\n");
  const block = findBlocks(markdown).find((candidate) => candidate.id === id);
  if (!block) return null;
  return lines.slice(block.openLine + 1, block.closeLine).join("\n");
}

export interface ReplaceBlocksOptions {
  /** Rendered markdown bodies keyed by marker id. */
  bodies: ReadonlyMap<string, string>;
}

/**
 * Rewrites the body of every marker pair whose id has a rendered body. Bodies
 * are inserted verbatim; a trailing newline is added so the closing marker
 * always starts on its own line.
 */
export function replaceBlocks(
  markdown: string,
  bodies: ReadonlyMap<string, string>,
): ReplaceBlocksResult {
  const blocks = findBlocks(markdown);
  const lines = markdown.split("\n");
  const replaced: string[] = [];
  const matched = new Set<string>();

  // Walk bottom-up so earlier line indexes stay valid.
  for (const block of [...blocks].reverse()) {
    const body = bodies.get(block.id);
    if (body === undefined) continue;
    matched.add(block.id);
    const inserted = body.length === 0 ? [] : [...body.split("\n"), ""];
    lines.splice(block.openLine + 1, block.closeLine - block.openLine - 1, ...inserted);
    replaced.push(block.id);
  }

  const missing = [...bodies.keys()].filter((id) => !matched.has(id)).sort();
  const unmatched = blocks.map((block) => block.id).filter((id) => !bodies.has(id)).sort();

  return {
    markdown: lines.join("\n"),
    replaced: replaced.sort(),
    missing,
    unmatched,
  };
}

/** Returns the human readable first difference between two texts. */
export function firstDifference(expected: string, actual: string): string | null {
  if (expected === actual) return null;
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const max = Math.max(expectedLines.length, actualLines.length);
  for (let i = 0; i < max; i += 1) {
    const a = expectedLines[i];
    const b = actualLines[i];
    if (a === b) continue;
    return `line ${i + 1}: README has ${JSON.stringify(a ?? "<end of file>")}, snapshot has ${JSON.stringify(b ?? "<end of file>")}`;
  }
  return null;
}
