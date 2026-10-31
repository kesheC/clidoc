#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ClidocError } from "./errors.js";
import { createSnapshot } from "./index.js";
import { DEFAULT_MAX_LINES, DEFAULT_README, renderReadme } from "./render.js";
import { readAllSnapshots } from "./store.js";

const NAME = "clidoc";
const VERSION = "0.1.5";

const USAGE = `${NAME} — record real CLI output straight into your README.

Usage:
  ${NAME} run    <cmd...>          record + render in one step (most common)
  ${NAME} record <cmd...>          capture a command into .clidoc/<id>.json
  ${NAME} render                   write .clidoc/*.json into README markers
  ${NAME} list                     list recorded snapshots

Options (record / run):
  --id <name>          snapshot id (default: derived from the command)
  --cwd <dir>          directory to run the command in (default: .)
  --timeout <ms>       kill the command after N ms (default: 15000)
  --env <K=V>          extra environment variable, repeatable
  --no-normalize       keep raw output (no path/time/id rewriting)
  --no-raw             drop stdoutRaw/stderrRaw from the snapshot file
  --stamp              store durationMs and recordedAt too

Options (render / run):
  --readme <file>      README to update (default: ${DEFAULT_README})
  --check              compare only, exit 1 when the README is stale
  --max-lines <n>      truncate code blocks after N lines (default: ${DEFAULT_MAX_LINES})
  --allow-missing      tolerate snapshots without markers and vice versa

Global:
  -h, --help           show this help
  -v, --version        print the version

README markers:
  <!-- clidoc:start <id> -->
  ...generated, do not edit...
  <!-- clidoc:end <id> -->

Examples:
  ${NAME} run node dist/cli.js --help
  ${NAME} record git log --oneline -5 --cwd . --id changelog
  ${NAME} render --check          # CI gate: fails when docs drift
`;

interface ParsedArgs {
  command: string | undefined;
  target: string[];
  id: string | undefined;
  cwd: string;
  timeoutMs: number;
  readme: string;
  check: boolean;
  maxLines: number;
  allowMissing: boolean;
  noNormalize: boolean;
  noRaw: boolean;
  stamp: boolean;
  env: Record<string, string>;
  help: boolean;
  version: boolean;
}

function parseNumber(flag: string, raw: string | undefined): number {
  const value = Number(raw);
  if (raw === undefined || !Number.isFinite(value) || value <= 0) {
    throw new ClidocError("usage", `${flag} needs a positive number, got ${raw ?? "nothing"}.`);
  }
  return value;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: undefined,
    target: [],
    id: undefined,
    cwd: ".",
    timeoutMs: 15000,
    readme: DEFAULT_README,
    check: false,
    maxLines: DEFAULT_MAX_LINES,
    allowMissing: false,
    noNormalize: false,
    noRaw: false,
    stamp: false,
    env: {},
    help: false,
    version: false,
  };

  const rest: string[] = [];
  let index = 0;
  for (; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg === "--") {
      rest.push(...argv.slice(index + 1));
      index = argv.length;
      break;
    }
    if (arg === "-h" || arg === "--help") {
      parsed.help = true;
      continue;
    }
    if (arg === "-v" || arg === "--version") {
      parsed.version = true;
      continue;
    }
    const next = (): string => {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new ClidocError("usage", `${arg} needs a value.`);
      }
      index += 1;
      return value;
    };

    switch (arg) {
      case "--id":
        parsed.id = next();
        break;
      case "--cwd":
        parsed.cwd = next();
        break;
      case "--readme":
        parsed.readme = next();
        break;
      case "--timeout":
        parsed.timeoutMs = parseNumber(arg, next());
        break;
      case "--max-lines": {
        const raw = next();
        const value = Number(raw);
        if (!Number.isInteger(value) || value <= 0) {
          throw new ClidocError("usage", `--max-lines needs a positive integer, got ${raw}.`);
        }
        parsed.maxLines = value;
        break;
      }
      case "--env": {
        const pair = next();
        const eq = pair.indexOf("=");
        if (eq <= 0) {
          throw new ClidocError("usage", `--env expects KEY=VALUE, got "${pair}".`);
        }
        parsed.env[pair.slice(0, eq)] = pair.slice(eq + 1);
        break;
      }
      case "--check":
        parsed.check = true;
        break;
      case "--allow-missing":
        parsed.allowMissing = true;
        break;
      case "--no-normalize":
        parsed.noNormalize = true;
        break;
      case "--no-raw":
        parsed.noRaw = true;
        break;
      case "--stamp":
        parsed.stamp = true;
        break;
      default:
        rest.push(arg);
    }
  }

  parsed.target = rest.slice(1).map((value) => value);
  parsed.command = rest[0];
  return parsed;
}

function resolveRoot(args: ParsedArgs): string {
  // --cwd is both "where the command runs" and "where .clidoc lives" unless
  // the caller overrides the readme path with something absolute.
  return path.resolve(args.cwd);
}

async function commandRecord(args: ParsedArgs): Promise<number> {
  const root = resolveRoot(args);
  const snapshot = await createSnapshot({
    root,
    argv: args.target,
    id: args.id,
    cwd: root,
    timeoutMs: args.timeoutMs,
    env: args.env,
    keepRaw: !args.noRaw,
    stamp: args.stamp,
    normalize: args.noNormalize ? false : {},
  });

  process.stdout.write(
    `recorded ${snapshot.id} (exit ${snapshot.exitCode ?? snapshot.signal ?? "null"})
`,
  );
  return 0;
}

async function commandRender(args: ParsedArgs): Promise<number> {
  const root = resolveRoot(args);
  const snapshots = await readAllSnapshots(root);

  if (snapshots.length === 0) {
    throw new ClidocError("snapshot", `No snapshots in ${path.join(root, ".clidoc")}. Run "${NAME} record" first.`);
  }

  const result = await renderReadme(snapshots, {
    root,
    readme: args.readme,
    check: args.check,
    maxLines: args.maxLines,
    allowMissing: args.allowMissing,
  });

  if (result.missing.length > 0) {
    process.stderr.write(`warning: no marker for ${result.missing.join(", ")}
`);
  }
  if (result.unmatched.length > 0) {
    process.stderr.write(`warning: no snapshot for ${result.unmatched.join(", ")}
`);
  }

  if (args.check) {
    if (!result.changed) {
      process.stdout.write(`${args.readme} is up to date (${result.rendered.length} block(s))
`);
      return 0;
    }
    process.stderr.write(
      `${args.readme} is stale:${result.difference ? ` ${result.difference}` : ""}
Run "${NAME} render" to update it.
`,
    );
    return 1;
  }

  process.stdout.write(
    `rendered ${result.rendered.length} block(s) into ${path.relative(process.cwd(), result.readmePath) || result.readmePath}${result.changed ? "" : " (no changes)"}
`,
  );
  return 0;
}

async function commandRun(args: ParsedArgs): Promise<number> {
  const recordCode = await commandRecord(args);
  if (recordCode !== 0) return recordCode;
  return commandRender(args);
}

async function commandList(args: ParsedArgs): Promise<number> {
  const root = resolveRoot(args);
  const snapshots = await readAllSnapshots(root);
  if (snapshots.length === 0) {
    process.stdout.write("no snapshots recorded yet\n");
    return 0;
  }
  for (const snapshot of snapshots) {
    const exit = snapshot.exitCode === 0 ? "ok" : `exit ${snapshot.exitCode ?? "null"}`;
    process.stdout.write(`${snapshot.id.padEnd(24)} ${exit.padEnd(8)} ${snapshot.command}\n`);
  }
  return 0;
}

export async function main(argv: readonly string[]): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    const message = error instanceof ClidocError ? error.message : String(error);
    process.stderr.write(`${NAME}: ${message}

${USAGE}`);
    return 2;
  }

  if (args.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (args.help || args.command === undefined) {
    // `clidoc` with no arguments prints usage on stderr and fails; `--help`
    // is an explicit request and succeeds.
    const stream = args.help ? process.stdout : process.stderr;
    stream.write(USAGE);
    return args.help ? 0 : 2;
  }

  try {
    switch (args.command) {
      case "run":
        return await commandRun(args);
      case "record":
        return await commandRecord(args);
      case "render":
        return await commandRender(args);
      case "list":
        return await commandList(args);
      default:
        throw new ClidocError(
          "usage",
          `Unknown command "${args.command}". Try "${NAME} --help".`,
        );
    }
  } catch (error) {
    if (error instanceof ClidocError) {
      process.stderr.write(`${NAME}: ${error.message}
`);
      return error.exitCode;
    }
    throw error;
  }
}

const stripExtension = (file: string): string => file.replace(/\.(?:[cm]?[jt]s)$/, "");

/**
 * True when this module is the process entry point (not imported by a test).
 *
 * Both sides are resolved through realpathSync because npm links the bin
 * shim to this file: process.argv[1] then holds the symlink path while
 * import.meta.url already holds the real one, so a plain string compare
 * silently skips main() and the command exits having done nothing.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    const invoked = stripExtension(realpathSync(entry));
    const self = stripExtension(realpathSync(fileURLToPath(import.meta.url)));
    return invoked === self;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${NAME}: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}