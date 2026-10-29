/**
 * Errors thrown by the clidoc library. `cli.ts` is the only place that turns
 * these into a process exit code, which keeps the library safe to import.
 */
export type ClidocErrorCode =
  | "usage"
  | "io"
  | "markdown"
  | "snapshot"
  | "spawn"
  | "check";

export class ClidocError extends Error {
  readonly code: ClidocErrorCode;
  readonly exitCode: number;

  constructor(code: ClidocErrorCode, message: string, exitCode = 2) {
    super(message);
    this.name = "ClidocError";
    this.code = code;
    this.exitCode = exitCode;
  }
}
