import { describe, expect, it } from "vitest";

import { ClidocError } from "../src/errors.js";
import { buildEnv, formatCommand, quoteArg, runAndCapture, PINNED_ENV } from "../src/record.js";

describe("buildEnv", () => {
  it("pins the deterministic variables", () => {
    const env = buildEnv({ parent: {} });
    for (const [key, value] of Object.entries(PINNED_ENV)) {
      expect(env[key]).toBe(value);
    }
    expect(env.TZ).toBe("UTC");
    expect(env.COLUMNS).toBe("80");
    expect(env.NO_COLOR).toBe("1");
  });

  it("drops colour and CI variables from the parent", () => {
    const env = buildEnv({
      parent: { PATH: "/bin", CI: "true", FORCE_COLOR: "3", CLICOLOR_FORCE: "1" } as NodeJS.ProcessEnv,
    });
    expect(env.PATH).toBe("/bin");
    expect(env.CI).toBeUndefined();
    expect(env.CLICOLOR_FORCE).toBeUndefined();
    expect(env.FORCE_COLOR).toBe("0");
  });

  it("lets callers add extra variables", () => {
    expect(buildEnv({ parent: {}, extra: { FOO: "bar" } }).FOO).toBe("bar");
  });
});

describe("quoteArg / formatCommand", () => {
  it("leaves simple words alone", () => {
    expect(quoteArg("--help")).toBe("--help");
    expect(quoteArg("dist/cli.js")).toBe("dist/cli.js");
  });

  it("single-quotes words with spaces", () => {
    expect(quoteArg("a b")).toBe("'a b'");
  });

  it("double-quotes when the argument contains single quotes", () => {
    expect(quoteArg("console.log('hi')")).toBe('"console.log(\'hi\')"');
  });

  it("escapes single quotes when double quotes are unsafe", () => {
    expect(quoteArg(`a'b"c`)).toBe(`'a'\\''b"c'`);
  });

  it("renders a whole command line", () => {
    expect(formatCommand(["node", "-e", "console.log(1)"])).toBe("node -e 'console.log(1)'");
  });
});

describe("runAndCapture", () => {
  it("captures stdout and a zero exit code", async () => {
    const result = await runAndCapture({
      argv: [process.execPath, "-e", "console.log('captured')"],
    });
    expect(result.stdout).toBe("captured\n");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it("captures stderr and a non-zero exit code", async () => {
    const result = await runAndCapture({
      argv: [process.execPath, "-e", "console.error('boom'); process.exit(3)"],
    });
    expect(result.stderr).toBe("boom\n");
    expect(result.exitCode).toBe(3);
  });

  it("passes extra environment variables to the child", async () => {
    const result = await runAndCapture({
      argv: [process.execPath, "-e", "console.log(process.env.CLIDOC_TEST_VALUE)"],
      env: { CLIDOC_TEST_VALUE: "injected" },
    });
    expect(result.stdout).toBe("injected\n");
  });

  it("pins TZ so dates are stable", async () => {
    const result = await runAndCapture({
      argv: [
        process.execPath,
        "-e",
        "console.log(new Date(0).toISOString())",
      ],
    });
    expect(result.stdout).toBe("1970-01-01T00:00:00.000Z\n");
  });

  it("kills a command that runs past the timeout", async () => {
    const result = await runAndCapture({
      argv: [process.execPath, "-e", "setTimeout(() => {}, 10000)"],
      timeoutMs: 400,
    });
    expect(result.timedOut).toBe(true);
    // Windows terminates the child without a POSIX signal, so accept either sign.
    expect(result.signal !== null || result.exitCode !== 0).toBe(true);
  });

  it("rejects an empty argv", async () => {
    await expect(runAndCapture({ argv: [] })).rejects.toThrowError(ClidocError);
  });

  it("rejects a command that does not exist", async () => {
    await expect(
      runAndCapture({ argv: ["clidoc-definitely-not-a-real-binary"] }),
    ).rejects.toThrowError(/Command not found/);
  });

  it("rejects a non-positive timeout", async () => {
    await expect(
      runAndCapture({ argv: [process.execPath, "-e", ""], timeoutMs: 0 }),
    ).rejects.toThrowError(/--timeout/);
  });
});
