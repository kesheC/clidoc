#!/usr/bin/env node
import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ClidocError } from "./errors.js";
import { createSnapshot } from "./index.js";
import { DEFAULT_MAX_LINES, DEFAULT_README, renderReadme } from "./render.js";
import { readAllSnapshots } from "./store.js";

const NAME = "clidoc";
const VERSION = "0.1.9";

const USAGE = `${NAME} — record real CLI output straight into your README.

Usage:
  ${NAME} run    <cmd...>          record + render in one step (most common)
  ${NAME} record <cmd...>          capture a command into .clidoc/<id>.json
  ${NAME} render                   write .clidoc/*.json into README markers
  ${NAME} list                     list recorded snapshots

Options (record only):
  --id <name>          snapshot id (default: derived from the command)
  --cwd <dir>          directory the command runs in (default: .)
  --timeout <ms>       kill the command after N ms (default: 15000)
  --env <K=V>          extra environment variable, repeatable
  --no-normalize       keep raw output (no path/time/id rewriting)
  --no-raw             drop stdoutRaw/stderrRaw from the snapshot file
  --stamp              store durationMs and recordedAt too

Options (render only):
  --readme <file>      README to update (default: ${DEFAULT_README})
  --check              compare only, exit 1 when the README is stale
  --allow-missing      tolerate snapshots without markers and vice versa

Options (record and render, so also run):
  --max-lines <n>      truncate code blocks after N lines (default: ${DEFAULT_MAX_LINES})

Global (every command):
  --root <dir>         project root holding .clidoc/ (default: .)
  -h, --help           show this help
  -v, --version        print the version

An option the chosen command does not read is a usage error (exit 2) rather
than a silent no-op: \`clidoc list --max-lines 5\` is rejected, not ignored.

README markers:
  <!-- clidoc:start <id> -->
  ...generated, do not edit...
  <!-- clidoc:end <id> -->

Argument passing:
  Everything before "--" is a ${NAME} option; everything after it is handed to the
  command untouched, even when it looks like a ${NAME} flag. A ${NAME} option that
  appears first still wins: --help before "--" shows this help instead of
  running anything.

Positional arguments:
  run and record hand them to the command. render and list take none, so
  passing one is a usage error rather than a silent no-op.

Examples:
  ${NAME} run --id help -- node dist/cli.js --help
  ${NAME} record --id changelog -- git log --oneline -5
  ${NAME} record --id api --cwd packages/api -- npm test
  ${NAME} render --check          # CI gate: fails when docs drift
`;

/** Every long option the parser accepts, for "did you mean" suggestions. */
const KNOWN_OPTIONS = [
  "--id",
  "--cwd",
  "--root",
  "--readme",
  "--timeout",
  "--max-lines",
  "--env",
  "--check",
  "--allow-missing",
  "--no-normalize",
  "--no-raw",
  "--stamp",
  "--help",
  "--version",
] as const;

/** Plain Levenshtein distance; inputs here are short option names. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min((previous[j] as number) + 1, (current[j - 1] as number) + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length] as number;
}

const KNOWN_COMMANDS = ["run", "record", "render", "list"] as const;

/**
 * A mistyped command left the child argv in place, so it looked exactly like
 * `record <cmd>`. With "--" present the intent was unambiguous, which makes a
 * silent record far more dangerous than an error.
 */
function unknownCommandMessage(command: string): string {
  let best: string | undefined;
  let bestDistance = 3;
  for (const known of KNOWN_COMMANDS) {
    const distance = editDistance(command, known);
    if (distance < bestDistance) {
      best = known;
      bestDistance = distance;
    }
  }
  const suggestion = best ? ` Did you mean "${best}"?` : "";
  return `unknown command "${command}".${suggestion} Run "${NAME} --help" to list the commands.`;
}

function unknownOptionMessage(arg: string): string {
  const suggestion = suggestOption(arg);
  if (suggestion) {
    return `unknown option "${arg}". Did you mean "${suggestion}"?`;
  }
  // Without a near match the likeliest cause is a flag meant for the command,
  // typed before the "--" separator.
  return `unknown option "${arg}". Arguments for the recorded command go after "--"; run "${NAME} --help" to list the options.`;
}

/** The closest known option, when one is close enough to be worth naming. */
function suggestOption(arg: string): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const option of KNOWN_OPTIONS) {
    const distance = editDistance(arg, option);
    if (distance < bestDistance) {
      best = option;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The options each command actually reads, verified against the code rather
 * than against the help text: --cwd only ever reaches resolveChildCwd() from
 * commandRecord(), --readme/--check/--allow-missing only reach renderReadme(),
 * and commandList() reads nothing but the root.
 *
 * The parser stays command-agnostic on purpose; this table is the second gate
 * that stops `list --max-lines 5` from looking like it did something.
 */
const COMMON_OPTIONS = ["--root", "--help", "--version"] as const;

const RECORD_OPTIONS: readonly string[] = [
  ...COMMON_OPTIONS,
  "--id",
  "--cwd",
  "--timeout",
  "--env",
  "--no-normalize",
  "--no-raw",
  "--stamp",
  "--max-lines",
];

const RENDER_OPTIONS: readonly string[] = [
  ...COMMON_OPTIONS,
  "--readme",
  "--check",
  "--allow-missing",
  "--max-lines",
];

/** Commands, in help order, and the options each one really consumes. */
const COMMAND_OPTIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["run", new Set<string>([...RECORD_OPTIONS, ...RENDER_OPTIONS])],
  ["record", new Set<string>(RECORD_OPTIONS)],
  ["render", new Set<string>(RENDER_OPTIONS)],
  ["list", new Set<string>(COMMON_OPTIONS)],
]);

/** "record", "record and run", "record, render and run". */
function formatCommandList(commands: readonly string[]): string {
  if (commands.length <= 1) return commands[0] ?? "";
  return `${commands.slice(0, -1).join(", ")} and ${commands[commands.length - 1] as string}`;
}

/** Reading order for prose: the narrow commands first, "run" as the union last. */
const COMMAND_ORDER = ["record", "render", "run", "list"] as const;

/** Which commands do read the option; used to keep the error actionable. */
function commandsReading(option: string): string[] {
  const readers: string[] = [];
  for (const command of COMMAND_ORDER) {
    if (COMMAND_OPTIONS.get(command)?.has(option) === true) readers.push(command);
  }
  return readers;
}

interface ParsedArgs {
  command: string | undefined;
  target: string[];
  id: string | undefined;
  /** Snapshot/README root. Always the working directory unless --root wins. */
  root: string | undefined;
  /** Directory the child runs in. */
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
  /** True when "--" was present, so later flags belong to the child. */
  afterSeparator: boolean;
  /** The user actually typed --root / --cwd (as opposed to the defaults). */
  rootGiven: boolean;
  cwdGiven: boolean;
  /** Every long option the user actually typed, so each command can reject it. */
  given: Set<string>;
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
    root: undefined,
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
    afterSeparator: false,
    rootGiven: false,
    cwdGiven: false,
    given: new Set<string>(),
  };

  const rest: string[] = [];
  let afterSeparator = false;
  let index = 0;
  for (; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg === "--") {
      rest.push(...argv.slice(index + 1));
      afterSeparator = true;
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

    // --flag=value is one token to the shell and two ideas to a reader. Split
    // it here so every case below still sees the bare flag name; "--root=."
    // used to be reported as an unknown option.
    let value = arg;
    let inline: string | undefined;
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq > 2) {
        value = arg.slice(0, eq);
        inline = arg.slice(eq + 1);
      }
    }

    // Remember what was typed before it becomes a value: --cwd, --readme and
    // friends carry defaults, so the parsed value cannot answer "did the user
    // actually ask for this?".
    if (value.startsWith("--")) {
      parsed.given.add(value);
    }

    switch (value) {
      case "--id":
        parsed.id = inline ?? next();
        break;
      case "--cwd":
        parsed.cwd = inline ?? next();
        parsed.cwdGiven = true;
        break;
      case "--root":
        parsed.root = inline ?? next();
        parsed.rootGiven = true;
        break;
      case "--readme":
        parsed.readme = inline ?? next();
        break;
      case "--timeout":
        parsed.timeoutMs = parseNumber(value, inline ?? next());
        break;
      case "--max-lines": {
        const raw = inline ?? next();
        const value = Number(raw);
        if (!Number.isInteger(value) || value <= 0) {
          throw new ClidocError("usage", `--max-lines needs a positive integer, got ${raw}.`);
        }
        parsed.maxLines = value;
        break;
      }
      case "--env": {
        const pair = inline ?? next();
        const eq = pair.indexOf("=");
        if (eq <= 0) {
          throw new ClidocError("usage", `--env expects KEY=VALUE, got "${pair}".`);
        }
        parsed.env[pair.slice(0, eq)] = pair.slice(eq + 1);
        break;
      }
      case "--check":
        rejectInline(inline, value);
        parsed.check = true;
        break;
      case "--allow-missing":
        rejectInline(inline, value);
        parsed.allowMissing = true;
        break;
      case "--no-normalize":
        rejectInline(inline, value);
        parsed.noNormalize = true;
        break;
      case "--no-raw":
        rejectInline(inline, value);
        parsed.noRaw = true;
        break;
      case "--stamp":
        rejectInline(inline, value);
        parsed.stamp = true;
        break;
      default:
        // Anything dash-shaped that reached this point is a typo or a flag from
        // a newer version. Silently treating it as a positional is how
        // `render --chek` used to run a destructive render and exit 0.
        // A lone "-" is the conventional stdin placeholder, not an option.
        if (arg.startsWith("-") && arg !== "-") {
          throw new ClidocError("usage", unknownOptionMessage(value));
        }
        rest.push(arg);
    }
  }

  parsed.target = rest.slice(1).map((value) => value);
  parsed.command = rest[0];
  parsed.afterSeparator = afterSeparator;
  return parsed;
}

/** "--check=yes" is a typo, not a boolean with a value. */
function rejectInline(inline: string | undefined, flag: string): void {
  if (inline === undefined) return;
  throw new ClidocError("usage", `${flag} does not take a value.`);
}

/**
 * Reject an option the chosen command never reads. Silently dropping it is the
 * worst outcome: `render --id nope` used to render every block and exit 0, so
 * a typo looked exactly like a success. Unknown commands fall through to the
 * dispatch switch so their suggestion is the one the user sees.
 */
function assertOptionsUsedByCommand(args: ParsedArgs): void {
  if (args.command === undefined) return;
  const accepted = COMMAND_OPTIONS.get(args.command);
  if (accepted === undefined) return;
  for (const option of args.given) {
    if (accepted.has(option) || option === "--help" || option === "--version") continue;
    const readers = commandsReading(option);
    const applies = readers.length > 0 ? `; it applies to ${formatCommandList(readers)}` : "";
    throw new ClidocError(
      "usage",
      `\`${args.command}\` does not read ${option}${applies}. Run "${NAME} --help" to list the options per command.`,
    );
  }
}

/**
 * A directory option must point at a directory that exists. Without this,
 * `render --check --root C:/nope` reported "no snapshots" (exit 2 only by
 * luck) and any command with a typo'd --cwd looked like a passing run.
 */
function assertDirectory(target: string, flag: string): string {
  let stats;
  try {
    stats = statSync(target);
  } catch {
    throw new ClidocError("usage", `${flag} points at "${target}", which does not exist.`);
  }
  if (!stats.isDirectory()) {
    throw new ClidocError("usage", `${flag} points at "${target}", which is not a directory.`);
  }
  return target;
}

/**
 * Where `.clidoc/` and the README live. This is deliberately independent of
 * `--cwd`: recording `--cwd subdir` must not move the snapshot out of the
 * project, otherwise a plain `clidoc render` at the root finds nothing.
 */
function resolveRoot(args: ParsedArgs): string {
  return assertDirectory(path.resolve(args.root ?? "."), "--root");
}

/** Where the child process actually runs; `--cwd` only ever means this. */
function resolveChildCwd(args: ParsedArgs): string {
  return assertDirectory(path.resolve(args.cwd), "--cwd");
}

/** Keys whose values are almost certainly secrets and must not reach the README. */
const SECRET_KEY = /(?:secret|token|passw(?:or)?d|api[-_]?key|private[-_]?key|credential|auth)/i;

function warnAboutEnv(args: ParsedArgs): void {
  for (const key of Object.keys(args.env)) {
    if (SECRET_KEY.test(key)) {
      process.stderr.write(
        `warning: --env ${key} looks secret and will be written verbatim into README.md.\n`,
      );
    }
  }
}

/**
 * Reject a positional argument the chosen command has nowhere to put.
 *
 * `run` and `record` pass their positionals to the child process, so anything
 * goes there. `render` and `list` read no positionals at all, and the parser
 * was collecting them anyway: `clidoc list extra.md` listed the snapshots and
 * exited 0, which reads as "that argument was fine".
 */
function assertNoStrayPositionals(args: ParsedArgs): void {
  if (args.command !== "render" && args.command !== "list") return;
  const stray = args.target[0];
  if (stray === undefined) return;
  throw new ClidocError(
    "usage",
    `${args.command} does not take arguments (got "${stray}"). Run "${NAME} --help" to list the options per command.`,
  );
}

async function commandRecord(args: ParsedArgs): Promise<number> {
  warnAboutEnv(args);
  const root = resolveRoot(args);
  const snapshot = await createSnapshot({
    root,
    argv: args.target,
    id: args.id,
    cwd: resolveChildCwd(args),
    timeoutMs: args.timeoutMs,
    env: args.env,
    keepRaw: !args.noRaw,
    stamp: args.stamp,
    maxLines: args.maxLines,
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
    // Options are parsed command-agnostically; reject the ones this command
    // never reads before any of them can look like they took effect.
    assertOptionsUsedByCommand(args);

    // Validate the directories the user actually named, for every command.
    // Only checking them where they are used is how `render --cwd <typo>` used
    // to succeed while doing nothing with the flag.
    if (args.rootGiven) assertDirectory(path.resolve(args.root ?? "."), "--root");
    if (args.cwdGiven) assertDirectory(path.resolve(args.cwd), "--cwd");

    assertNoStrayPositionals(args);

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
        throw new ClidocError("usage", unknownCommandMessage(args.command));
    }
  } catch (error) {
    if (error instanceof ClidocError) {
      process.stderr.write(`${NAME}: ${error.message}
`);
      return error.exitCode;
    }
    // A raw fs failure (EPERM/EACCES/EISDIR/ENOENT while writing) must not look
    // like a drift verdict: --check owns exit 1, everything else is 2.
    const code = (error as NodeJS.ErrnoException).code;
    const message = error instanceof Error ? error.message : String(error);
    // Node already prefixes fs errors with the code ("EPERM: operation …").
    const detail = code && !message.startsWith(code) ? `${code}: ${message}` : message;
    process.stderr.write(`${NAME}: ${detail}
`);
    return 2;
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