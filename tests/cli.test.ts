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

describe("unknown options", () => {
  // B2 (round 2): "render --chek" used to fall through to a plain render,
  // rewrite the README and exit 0 — a broken CI gate that edits docs.
  it("refuses a mistyped --check and leaves the README byte-identical", async () => {
    await cli(["record", "--id", "a", "--", "node", "-e", "console.log('real')"]);
    const readme = path.join(root, "README.md");
    await fs.writeFile(
      readme,
      "# t\n\n<!-- clidoc:start a -->\nOLD\n<!-- clidoc:end a -->\n",
      "utf8",
    );
    const before = await fs.readFile(readme);

    const run = await cli(["render", "--chek"]);

    expect(run.code).toBe(2);
    expect(run.stderr).toContain('unknown option "--chek"');
    expect(run.stderr).toContain("--check");
    expect(await fs.readFile(readme)).toEqual(before);
  });

  it("rejects an unknown option for every command", async () => {
    const runs = await Promise.all(
      ["render", "record", "run", "list"].map((command) => cli([command, "--nope"])),
    );
    for (const run of runs) {
      expect(run.code).toBe(2);
      expect(run.stderr).toContain('unknown option "--nope"');
    }
  });

  it("still accepts --check and prints the drift verdict", async () => {
    await cli(["record", "--id", "a", "--", "node", "-e", "console.log('one')"]);
    await cli(["render"]);
    const check = await cli(["render", "--check"]);
    expect(check.code).toBe(0);
    expect(check.stdout).toContain("up to date");
  });

  it("does not treat a child flag after the separator as unknown", async () => {
    const run = await cli(["record", "--id", "a", "--", "echo", "--nope"]);
    expect(run.code).toBe(0);
  });

  it("keeps a lone dash usable as a command argument", async () => {
    const run = await cli(["record", "--id", "a", "--", "echo", "-"]);
    expect(run.code).toBe(0);
  });

  it("names the separator when the option is not a near-miss", async () => {
    const run = await cli(["record", "--id", "a", "--where", "x"]);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('after "--"');
  });

  it("suggests the intended command on a typo", async () => {
    const run = await cli(["rendr"]);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('Did you mean "render"?');
  });
});

describe("directory options", () => {
  it("fails when --cwd does not exist, for the commands that read it", async () => {
    const missing = path.join(root, "no", "such", "dir");
    await cli(["record", "--id", "a", "--", "node", "-e", "0"]);
    const runs = await Promise.all(
      ["record", "run"].map((command) =>
        cli([command, "--id", "a", "--cwd", missing, "--", "node", "-e", "0"]),
      ),
    );
    for (const run of runs) {
      expect(run.code).toBe(2);
      expect(run.stderr).toContain("does not exist");
    }
  });

  // --cwd never reaches render or list, so those two must say so instead of
  // validating a directory they were never going to use.
  it("rejects --cwd on the commands that never read it", async () => {
    const runs = await Promise.all(
      ["render", "list"].map((command) => cli([command, "--cwd", root])),
    );
    for (const run of runs) {
      expect(run.code).toBe(2);
      expect(run.stderr).toContain("--cwd");
      expect(run.stderr).toContain("does not read");
    }
  });

  it("fails when --root does not exist", async () => {
    const run = await cli(["render", "--root", path.join(root, "gone")]);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("does not exist");
  });

  it("rejects a --root that is a file", async () => {
    const run = await cli(["render", "--root", path.join(root, "README.md")]);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("not a directory");
  });

  it("accepts an existing --cwd for record and an existing --root for render", async () => {
    await cli(["record", "--id", "a", "--cwd", path.join(root, "sub"), "--", "node", "-e", "console.log('one')"]);
    await cli(["render"]);
    const run = await cli(["render", "--check", "--root", root]);
    expect(run.code).toBe(0);
  });
});

describe("options a command never reads", () => {
  // Silently dropping a flag is how `render --id nope` used to render every
  // block and exit 0: the typo looked exactly like a success.
  const REJECTED: { argv: string[]; flag: string; applies: string }[] = [
    { argv: ["list", "--max-lines", "5"], flag: "--max-lines", applies: "record, render and run" },
    { argv: ["list", "--readme", "OTHER.md"], flag: "--readme", applies: "render and run" },
    { argv: ["list", "--id", "nope"], flag: "--id", applies: "record and run" },
    { argv: ["render", "--id", "nope"], flag: "--id", applies: "record and run" },
    { argv: ["render", "--timeout", "500"], flag: "--timeout", applies: "record and run" },
    { argv: ["render", "--env", "A=B"], flag: "--env", applies: "record and run" },
    { argv: ["render", "--stamp"], flag: "--stamp", applies: "record and run" },
    { argv: ["render", "--no-raw"], flag: "--no-raw", applies: "record and run" },
    { argv: ["record", "--check"], flag: "--check", applies: "render and run" },
    { argv: ["record", "--allow-missing"], flag: "--allow-missing", applies: "render and run" },
  ];

  it.each(REJECTED)("rejects $flag on $argv.0", async ({ argv, flag, applies }) => {
    const readme = await fs.readFile(path.join(root, "README.md"), "utf8");
    const run = await cli(argv);

    expect(run.code).toBe(2);
    expect(run.stderr).toContain(flag);
    expect(run.stderr).toContain(`does not read ${flag}`);
    expect(run.stderr).toContain(applies);
    // Nothing ran: a rejected option must not have written to the README.
    expect(await fs.readFile(path.join(root, "README.md"), "utf8")).toBe(readme);
  });

  it("still accepts --max-lines where it is read", async () => {
    const threeLines = ["1", "2", "3"].join(String.fromCharCode(10));
    await cli(["record", "--id", "a", "--max-lines", "1", "--", "node", "-e", `process.stdout.write("${threeLines}")`]);
    const render = await cli(["render"]);
    expect(render.code).toBe(0);
    const readme = await fs.readFile(path.join(root, "README.md"), "utf8");
    expect(readme).toMatch(/\n\.\.\. \(\d+ more lines?\)\n/);
  });

  it("still accepts --readme, --check and --allow-missing on render", async () => {
    await cli(["record", "--id", "a", "--", "node", "-e", "console.log('one')"]);
    await fs.writeFile(
      path.join(root, "OTHER.md"),
      "# t\n\n<!-- clidoc:start a -->\n<!-- clidoc:end a -->\n",
      "utf8",
    );
    const run = await cli(["render", "--readme", "OTHER.md", "--check", "--allow-missing"]);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("stale");
  });

  it("rejects a command that never reads the option even before the separator", async () => {
    // The flag is still a clidoc option: it is rejected, not forwarded.
    const run = await cli(["list", "--max-lines", "5", "--", "echo", "hi"]);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("does not read --max-lines");
  });

  it("lets --help through for every command", async () => {
    const runs = await Promise.all(
      ["record", "render", "run", "list"].map((command) => cli([command, "--help"])),
    );
    for (const run of runs) {
      expect(run.code).toBe(0);
      expect(run.stdout).toContain("Usage:");
    }
  });
});
