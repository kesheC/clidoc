import { spawn } from "node:child_process";
import path from "node:path";

import { ClidocError } from "./errors.js";
import type { CaptureResult } from "./types.js";

/** Environment variables that make CLI output depend on the caller's shell. */
export const SCRUBBED_ENV = [
  "CLICOLOR",
  "CLICOLOR_FORCE",
  "FORCE_COLOR",
  "COLORTERM",
  "NO_COLOR",
  "TERM_PROGRAM",
  "CI",
  "GITHUB_ACTIONS",
  "BUILD_NUMBER",
  "npm_config_color",
] as const;

/**
 * Environment every recorded command runs under. Pinning these keeps stdout
 * byte-identical between a laptop on Windows, a Linux CI box and a container.
 */
export const PINNED_ENV: Readonly<Record<string, string>> = {
  COLUMNS: "80",
  LINES: "40",
  TZ: "UTC",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  NO_COLOR: "1",
  FORCE_COLOR: "0",
};

/** Variables inherited from the parent process. Everything else is dropped. */
const INHERITED_ENV = [
  "PATH",
  "PATHEXT",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "SystemRoot",
  "windir",
  "ComSpec",
  "SYSTEMDRIVE",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "OS",
  "SHELL",
];

export interface BuildEnvOptions {
  /** Extra variables merged last, so a caller can add `FOO=bar`. */
  extra?: Record<string, string>;
  /** Parent environment; defaults to `process.env` (injectable for tests). */
  parent?: NodeJS.ProcessEnv;
}

/** Builds the pinned child environment used by every capture. */
export function buildEnv(options: BuildEnvOptions = {}): Record<string, string> {
  const parent = options.parent ?? process.env;
  const env: Record<string, string> = {};

  for (const key of INHERITED_ENV) {
    const value = parent[key] ?? parent[key.toUpperCase()];
    if (typeof value === "string") env[key] = value;
  }
  for (const [key, value] of Object.entries(PINNED_ENV)) env[key] = value;
  for (const [key, value] of Object.entries(options.extra ?? {})) env[key] = value;

  return env;
}

/**
 * Quotes one argv entry so the rendered `$ command` line can be pasted back
 * into a POSIX shell. Double quotes are used where they are unambiguous
 * (`node -e "console.log('hi')"`), single quotes otherwise.
 */
export function quoteArg(raw: string): string {
  // A literal ESC in argv would recreate terminal escapes in the README and
  // swallow the "$ command" line; show it rather than emit it.
  const arg = raw
    .replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B/g, "\\e");
  if (arg.length === 0) return "''";
  if (/^[A-Za-z0-9_@%+=:,./\\-]+$/.test(arg)) return arg;
  const safeInDouble = !/["`$\\!]/.test(arg);
  if (safeInDouble && arg.includes("'")) return `"${arg}"`;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/** Renders an argv array as a copy-pasteable POSIX command line. */
export function formatCommand(argv: readonly string[]): string {
  return argv.map((arg) => quoteArg(arg)).join(" ");
}

export interface CaptureOptions {
  /** Arguments to spawn; no shell is involved, so there is nothing to inject. */
  argv: string[];
  /** Directory to run in. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Milliseconds before the child is killed. Defaults to 15000. */
  timeoutMs?: number;
  /** Extra environment variables for the child. */
  env?: Record<string, string>;
}

/**
 * Runs one command with a pinned environment and a hard timeout, collecting
 * stdout/stderr/exit code. Never uses a shell.
 */
export function runAndCapture(options: CaptureOptions): Promise<CaptureResult> {
  const { argv } = options;
  if (argv.length === 0) {
    return Promise.reject(new ClidocError("usage", "No command given to record."));
  }

  const cwd = path.resolve(options.cwd ?? process.cwd());
  const timeoutMs = options.timeoutMs ?? 15000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(
      new ClidocError("usage", `--timeout must be a positive number, got ${timeoutMs}.`),
    );
  }

  const file = argv[0] as string;
  const startedAt = Date.now();

  return new Promise<CaptureResult>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let stdout = "";
    let stderr = "";
    let timer: NodeJS.Timeout | undefined;

    const child = spawn(file, argv.slice(1), {
      cwd,
      env: buildEnv({ extra: options.env }),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const finish = (result: CaptureResult): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const hint =
        error.code === "ENOENT"
          ? ` Command not found: ${file}`
          : error.code === "EACCES"
            ? ` Command not executable: ${file}`
            : "";
      reject(new ClidocError("spawn", `Failed to run "${file}".${hint}`));
    });

    child.on("close", (code, signal) => {
      finish({
        argv,
        command: formatCommand(argv),
        cwd,
        exitCode: code,
        signal: signal ?? null,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      });
    });

    timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref?.();
  });
}
