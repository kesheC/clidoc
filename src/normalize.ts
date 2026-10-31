import os from "node:os";

/** Rules that can be turned off with `--no-normalize` one by one. */
export const NORMALIZER_NAMES = [
  "ansi",
  "lineEndings",
  "trailingWhitespace",
  "pathList",
  "cwd",
  "home",
  "pathSeparators",
  "isoTimestamp",
  "dateTime",
  "uuid",
  "hexId",
  "duration",
  "size",
] as const;

export type NormalizerName = (typeof NORMALIZER_NAMES)[number];

export interface NormalizeChange {
  rule: NormalizerName;
  count: number;
}

export interface NormalizeResult {
  text: string;
  changes: NormalizeChange[];
}

export interface NormalizeOptions {
  /** Directory that gets collapsed to `.`. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Directory that gets collapsed to `~`. Defaults to the OS home directory. */
  homeDir?: string;
  /** PATH value that gets collapsed to `<path>`. Defaults to `process.env.PATH`. */
  pathValue?: string;
  /** Set to false to disable every rule. Defaults to true. */
  enabled?: boolean;
  /** Rules to skip, e.g. `["size"]` for output that legitimately reports bytes. */
  disable?: NormalizerName[];
}

interface RuleContext {
  cwd: string;
  homeDir: string;
  pathValue: string;
}

type Rule = (text: string, ctx: RuleContext) => { text: string; count: number };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyRegex(
  text: string,
  pattern: RegExp,
  replacement: string,
): { text: string; count: number } {
  const matches = text.match(pattern);
  return {
    text: text.replace(pattern, replacement),
    count: matches ? matches.length : 0,
  };
}

/**
 * Replaces `dir` with `replacement` in every separator/casing variant a
 * Windows or POSIX child process might print.
 */
function replaceDirectory(
  text: string,
  dir: string,
  replacement: string,
): { text: string; count: number } {
  if (!dir || dir === "/" || dir.length < 3) return { text, count: 0 };

  const forward = dir.replace(/\\/g, "/");
  const variants = new Set<string>([
    dir,
    forward,
    dir.replace(/\//g, "\\"),
    forward.replace(/\//g, "\\"),
  ]);
  if (process.platform === "win32") {
    variants.add(dir.toLowerCase());
    variants.add(forward.toLowerCase());
  }

  const ordered = [...variants]
    .filter((variant) => variant.length > 0)
    .sort((a, b) => b.length - a.length);

  let out = text;
  let count = 0;
  for (const variant of ordered) {
    const pattern = new RegExp(escapeRegExp(variant), "g");
    const matches = out.match(pattern);
    if (!matches) continue;
    count += matches.length;
    out = out.replace(pattern, replacement);
  }
  return { text: out, count };
}

const RULES: Record<NormalizerName, Rule> = {
  ansi: (text) => {
    let count = 0;
    let out = text;
    const csi = /\u001B\[[0-?]*[ -/]*[@-~]/g;
    const osc = /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\\\)/g;
    for (const pattern of [csi, osc]) {
      const matches = out.match(pattern);
      if (matches) {
        count += matches.length;
        out = out.replace(pattern, "");
      }
    }
    return { text: out, count };
  },

  lineEndings: (text) => {
    const crlf = (text.match(/\r\n/g) ?? []).length;
    const cr = (text.replace(/\r\n/g, "").match(/\r/g) ?? []).length;
    return {
      text: text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"),
      count: crlf + cr,
    };
  },

  trailingWhitespace: (text) => applyRegex(text, /[ \t]+$/gm, ""),

  // The child inherits PATH, so `echo $PATH` would publish the maintainer's
  // machine layout. Collapse the exact value to one stable token.
  pathList: (text, ctx) => {
    const value = ctx.pathValue;
    if (value.length < 3 || !text.includes(value)) return { text, count: 0 };
    const parts = text.split(value);
    return { text: parts.join("<path>"), count: parts.length - 1 };
  },

  cwd: (text, ctx) => replaceDirectory(text, ctx.cwd, "."),

  home: (text, ctx) => replaceDirectory(text, ctx.homeDir, "~"),

  // `./x\y` becomes `./x/y` so a snapshot recorded on Windows still matches
  // the same output on Linux. Only backslashes inside path-ish tokens are
  // touched, never in ordinary prose.
  pathSeparators: (text) => {
    let count = 0;
    const out = text.replace(
      /(?<![\w./~-])((?:\.{1,2}|~|[A-Za-z]:)[/\\][^\s"'`)]*)/g,
      (match) => {
        if (!match.includes("\\")) return match;
        count += 1;
        return match.replace(/\\/g, "/");
      },
    );
    return { text: out, count };
  },

  isoTimestamp: (text) =>
    applyRegex(
      text,
      /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g,
      "<timestamp>",
    ),

  dateTime: (text) =>
    applyRegex(text, /\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/g, "<time>"),

  uuid: (text) =>
    applyRegex(
      text,
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "<id>",
    ),

  hexId: (text) => applyRegex(text, /\b[0-9a-f]{16,}\b/gi, "<id>"),

  duration: (text) =>
    applyRegex(
      text,
      /\b\d+(?:\.\d+)?\s?(?:ms|msec|milliseconds?|secs?|seconds?)\b|\b\d+\.\d+\s?s\b/g,
      "<duration>",
    ),

  // "1.5 MB" and "1B" are sizes; "A=1 B=two" and "count 3 B variants" are not.
  // A bare "B" only counts when it touches the number, so free-standing
  // single-letter variables are never swallowed.
  size: (text) =>
    applyRegex(
      text,
      /\b\d+(?:\.\d+)?(?:\s?[KMGT]i?B|B)\b/g,
      "<size>",
    ),
};

/**
 * Rewrites volatile parts of a CLI's output (absolute paths, timestamps,
 * durations, random ids) into stable placeholders so a recorded snapshot only
 * changes when the CLI's behaviour actually changes.
 */
export function normalizeOutput(
  text: string,
  options: NormalizeOptions = {},
): NormalizeResult {
  if (options.enabled === false) return { text, changes: [] };

  const ctx: RuleContext = {
    cwd: options.cwd ?? process.cwd(),
    homeDir: options.homeDir ?? os.homedir(),
    pathValue: options.pathValue ?? process.env.PATH ?? "",
  };
  const skip = new Set<NormalizerName>(options.disable ?? []);

  const changes: NormalizeChange[] = [];
  let out = text;
  for (const name of NORMALIZER_NAMES) {
    if (skip.has(name)) continue;
    const result = RULES[name](out, ctx);
    out = result.text;
    if (result.count > 0) changes.push({ rule: name, count: result.count });
  }
  return { text: out, changes };
}
