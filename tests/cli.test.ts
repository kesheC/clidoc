import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Exercised through the built CLI because these behaviours are decided by
 * argv parsing and process exit codes, not by the library functions.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, "..", "dist", "cli.js");

let root = "";

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function cli(args: string[], cwd = root): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "clidoc-cli-"));
  await fs.writeFile(
    path.join(root, "README.md"),
    "# t\n\n<!-- clidoc:start a -->\n<!-- clidoc:end a -->\n",
    "utf8",
  );
  await fs.mkdir(path.join(root, "sub"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("-- separator handling", () => {
  // B3: a flag after "--" belongs to the child, never to clidoc.
  it("passes --help after the separator to the child", async () => {
    const run = await cli(["record", "--id", "a", "--", "echo", "--help"]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("recorded a");
    const snapshot = JSON.parse(
      await fs.readFile(path.join(root, ".clidoc", "a.json"), "utf8"),
    ) as { argv: string[] };
    expect(snapshot.argv).toEqual(["echo", "--help"]);
  });

  it("passes -h after the separator to the child", async () => {
    await cli(["record", "--id", "a", "--", "echo", "-h"]);
    const snapshot = JSON.parse(
      await fs.readFile(path.join(root, ".clidoc", "a.json"), "utf8"),
    ) as { argv: string[] };
    expect(snapshot.argv).toEqual(["echo", "-h"]);
  });

  it("treats --help before the separator as a request for help", async () => {
    const run = await cli(["run", "--id", "a", "--help", "--", "echo", "hi"]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("Usage:");
    await expect(fs.access(path.join(root, ".clidoc"))).rejects.toThrow();
  });

  it("rejects an id that looks like a flag", async () => {
    const run = await cli(["record", "--id", "--help", "--", "echo", "hi"]);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("Invalid snapshot id");
  });
});

describe("cwd and root", () => {
  // M1: --cwd moves the child, not the snapshot store.
  it("keeps the snapshot in the project root when --cwd points elsewhere", async () => {
    const run = await cli([
      "record",
      "--id",
      "a",
      "--cwd",
      "sub",
      "--",
      "node",
      "-e",
      "console.log(process.cwd())",
    ]);
    expect(run.code).toBe(0);

    const inRoot = await fs.readFile(path.join(root, ".clidoc", "a.json"), "utf8");
    expect(inRoot).toContain("a");
    await expect(fs.access(path.join(root, "sub", ".clidoc"))).rejects.toThrow();

    expect((await cli(["render"])).code).toBe(0);
    const check = await cli(["render", "--check"]);
    expect(check.code).toBe(0);
  });

  it("runs the child inside --cwd", async () => {
    // process.cwd() itself is normalised to ".", so prove the child's working
    // directory by the side effect instead: the file must land under sub/.
    await cli([
      "record",
      "--id",
      "a",
      "--cwd",
      "sub",
      "--",
      "node",
      "-e",
      "require('fs').writeFileSync('marker.txt','x')",
    ]);
    await expect(fs.access(path.join(root, "sub", "marker.txt"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(root, "marker.txt"))).rejects.toThrow();
  });
});

describe("render --check exit codes", () => {
  it("reports 1 for a stale README", async () => {
    await cli(["record", "--id", "a", "--", "node", "-e", "console.log('one')"]);
    await cli(["render"]);
    await cli(["record", "--id", "a", "--", "node", "-e", "console.log('two')"]);
    const check = await cli(["render", "--check"]);
    expect(check.code).toBe(1);
    expect(check.stderr).toContain("is stale");
  });

  it("reports 0 when everything matches", async () => {
    await cli(["record", "--id", "a", "--", "node", "-e", "console.log('one')"]);
    await cli(["render"]);
    const check = await cli(["render", "--check"]);
    expect(check.code).toBe(0);
  });
});

describe("id validation", () => {
  it("rejects a Windows reserved device name", async () => {
    const run = await cli(["record", "--id", "con", "--", "echo", "hi"]);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("reserved device name");
  });
});

describe("unsafe output", () => {
  // B1/B2 at the CLI level: run must leave a README clidoc can read back.
  it("leaves the README re-readable after a fence-injecting command", async () => {
    const run = await cli([
      "run",
      "--id",
      "a",
      "--",
      "node",
      "-e",
      "console.log('x');console.log(String.fromCharCode(96,96,96));console.log('<!-- clidoc:start ghost -->')",
    ]);
    expect(run.code).toBe(0);
    const check = await cli(["render", "--check"]);
    expect(check.code).toBe(0);
  });
});
