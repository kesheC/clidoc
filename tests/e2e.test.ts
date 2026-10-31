import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSnapshot } from "../src/index.js";
import { findBlocks, readBlockBody } from "../src/markdown.js";
import { runAndCapture } from "../src/record.js";
import { renderReadme } from "../src/render.js";
import { readAllSnapshots } from "../src/store.js";

let root = "";

const FENCE = "```";

const README = [
  "# Demo project",
  "",
  "<!-- clidoc:start greet -->",
  "hand-written, out of date",
  "<!-- clidoc:end greet -->",
  "",
  "<!-- clidoc:start failing -->",
  "(empty)",
  "<!-- clidoc:end failing -->",
  "",
].join("\n");

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "clidoc-e2e-"));
  await fs.writeFile(path.join(root, "README.md"), README, "utf8");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function record(id: string, script: string): Promise<void> {
  await createSnapshot({ root, id, argv: [process.execPath, "-e", script] });
}

describe("record -> render -> check", () => {
  it("writes a snapshot and renders it into the README", async () => {
    await record("greet", "console.log('hello from clidoc')");

    const snapshots = await readAllSnapshots(root);
    expect(snapshots.map((s) => s.id)).toEqual(["greet"]);

    const result = await renderReadme(snapshots, { root, allowMissing: true });
    expect(result.changed).toBe(true);
    expect(result.rendered).toEqual(["greet"]);

    const markdown = await fs.readFile(path.join(root, "README.md"), "utf8");
    expect(markdown).toContain("hello from clidoc");
    expect(markdown).not.toContain("hand-written, out of date");
    expect(markdown).toMatch(/^\$ .*-e /m);
    expect(findBlocks(markdown).map((b) => b.id)).toEqual(["greet", "failing"]);
  });

  it("is a no-op the second time", async () => {
    await record("greet", "console.log('stable')");
    const first = await renderReadme(await readAllSnapshots(root), { root, allowMissing: true });
    const second = await renderReadme(await readAllSnapshots(root), { root, allowMissing: true });
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.markdown).toBe(first.markdown);
  });

  it("check mode does not touch the file and reports the difference", async () => {
    await record("greet", "console.log('new text')");
    const before = await fs.readFile(path.join(root, "README.md"), "utf8");

    const result = await renderReadme(await readAllSnapshots(root), {
      root,
      check: true,
      allowMissing: true,
    });
    expect(result.changed).toBe(true);
    expect(result.difference).toContain("line 4");
    expect(await fs.readFile(path.join(root, "README.md"), "utf8")).toBe(before);
  });

  it("check mode reports no change when everything is current", async () => {
    await record("greet", "console.log('same')");
    await renderReadme(await readAllSnapshots(root), { root, allowMissing: true });
    const result = await renderReadme(await readAllSnapshots(root), {
      root,
      check: true,
      allowMissing: true,
    });
    expect(result.changed).toBe(false);
    expect(result.difference).toBeNull();
  });

  it("records a failing command with its exit code", async () => {
    await record("failing", "console.error('nope'); process.exit(2)");
    await renderReadme(await readAllSnapshots(root), { root, allowMissing: true });
    const markdown = await fs.readFile(path.join(root, "README.md"), "utf8");
    expect(markdown).toContain("[exit code: 2]");
    expect(markdown).toContain("nope");
  });

  it("keeps the code fence balanced after truncation", async () => {
    await record("greet", "for (let i = 0; i < 60; i++) console.log('line ' + i)");
    await renderReadme(await readAllSnapshots(root), { root, allowMissing: true, maxLines: 3 });
    const markdown = await fs.readFile(path.join(root, "README.md"), "utf8");
    expect(markdown).toContain("... (57 more lines)");
    // Only "greet" has a snapshot, so only its fence pair is written.
    const fences = markdown.split(FENCE).length - 1;
    expect(fences).toBe(2);
    expect(readBlockBody(markdown, "greet")).toContain(FENCE);
  });

  it("normalises the working directory out of the output", async () => {
    await createSnapshot({
      root,
      id: "greet",
      argv: [process.execPath, "-e", "console.log(process.cwd())"],
    });
    await renderReadme(await readAllSnapshots(root), { root, allowMissing: true });
    const markdown = await fs.readFile(path.join(root, "README.md"), "utf8");
    expect(markdown).toContain("\n.\n");
    expect(markdown).not.toContain(root);
  });

  it("refuses to render when a snapshot has no marker", async () => {
    await record("orphan", "console.log('x')");
    await expect(renderReadme(await readAllSnapshots(root), { root })).rejects.toThrowError(
      /no <!-- clidoc:start --> marker/,
    );
  });

  it("refuses to render when a marker has no snapshot", async () => {
    await record("greet", "console.log('x')");
    await expect(renderReadme(await readAllSnapshots(root), { root })).rejects.toThrowError(
      /no recorded snapshot/,
    );
  });

  it("fails clearly when the README is missing", async () => {
    await record("greet", "console.log('x')");
    await expect(
      renderReadme(await readAllSnapshots(root), { root, readme: "NOPE.md", allowMissing: true }),
    ).rejects.toThrowError(/README not found/);
  });

  it("produces the same snapshot across two runs", async () => {
    await record("greet", "console.log('deterministic output')");
    const first = await readAllSnapshots(root);
    await record("greet", "console.log('deterministic output')");
    const second = await readAllSnapshots(root);
    expect(first[0]?.stdout).toBe(second[0]?.stdout);
    expect(first[0]?.command).toBe(second[0]?.command);
  });
});

describe("line endings", () => {
  it("keeps a CRLF README stable instead of reporting a phantom drift", async () => {
    await record("greet", "console.log('hello from clidoc')");

    // Render once as LF, then convert the file to CRLF the way a Windows
    // checkout with core.autocrlf=true would hand it to us.
    await renderReadme(await readAllSnapshots(root), { root, allowMissing: true });
    const lf = await fs.readFile(path.join(root, "README.md"), "utf8");
    await fs.writeFile(path.join(root, "README.md"), lf.replace(/\n/g, "\r\n"), "utf8");

    const check = await renderReadme(await readAllSnapshots(root), {
      root,
      check: true,
      allowMissing: true,
    });
    expect(check.changed).toBe(false);
    expect(check.difference).toBeNull();

    const rewritten = await renderReadme(await readAllSnapshots(root), { root, allowMissing: true });
    expect(rewritten.changed).toBe(false);
    const onDisk = await fs.readFile(path.join(root, "README.md"), "utf8");
    expect(onDisk).toContain("hello from clidoc");
    expect(onDisk.includes("\r\n")).toBe(true);
    expect(onDisk.includes("\n\n\n")).toBe(false);
  });

  it("leaves an LF README as LF", async () => {
    await record("greet", "console.log('hello')");
    await renderReadme(await readAllSnapshots(root), { root, allowMissing: true });
    const onDisk = await fs.readFile(path.join(root, "README.md"), "utf8");
    expect(onDisk.includes("\r\n")).toBe(false);
  });
});

describe("runAndCapture integration", () => {
  it("captures a real node --version string", async () => {
    const result = await runAndCapture({ argv: [process.execPath, "--version"] });
    expect(result.stdout.trim()).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(result.exitCode).toBe(0);
  });
});

// B1/B2: output that contains fences or marker syntax must not corrupt the
// README, and a second render must still parse it.
describe("hostile command output", () => {
  const FENCE_AND_MARKER = [
    "console.log('text')",
    "console.log(String.fromCharCode(96,96,96))",
    "console.log('<!-- clidoc:start ghost -->')",
    "console.log('ghost body')",
    "console.log('<!-- clidoc:end ghost -->')",
  ].join(";");

  it("keeps the README parseable when the output emits a bare fence", async () => {
    await record("greet", "console.log('text');console.log(String.fromCharCode(96,96,96));console.log('injected')");
    await renderReadme(await readAllSnapshots(root), { root, allowMissing: true });

    const markdown = await fs.readFile(path.join(root, "README.md"), "utf8");
    expect(findBlocks(markdown).map((b) => b.id)).toEqual(["greet", "failing"]);

    const check = await renderReadme(await readAllSnapshots(root), {
      root,
      check: true,
      allowMissing: true,
    });
    expect(check.changed).toBe(false);
  });

  it("does not create a ghost block from marker syntax in the output", async () => {
    await record("greet", FENCE_AND_MARKER);
    await renderReadme(await readAllSnapshots(root), { root, allowMissing: true });

    const markdown = await fs.readFile(path.join(root, "README.md"), "utf8");
    expect(findBlocks(markdown).map((b) => b.id)).toEqual(["greet", "failing"]);
    expect(markdown).toContain("&lt;!-- clidoc:start ghost");

    // Rendering twice must not accumulate anything.
    const again = await renderReadme(await readAllSnapshots(root), {
      root,
      allowMissing: true,
    });
    expect(again.changed).toBe(false);
  });
});

// M3: the line budget travels with the snapshot so run and check agree.
describe("maxLines round-trip", () => {
  it("keeps a wide maxLines stable across record and check", async () => {
    const script = "for(let i=1;i<=100;i++)console.log('L'+i)";
    await createSnapshot({ root, id: "greet", argv: [process.execPath, "-e", script], maxLines: 200 });
    await renderReadme(await readAllSnapshots(root), { root, allowMissing: true });

    const check = await renderReadme(await readAllSnapshots(root), {
      root,
      check: true,
      allowMissing: true,
    });
    expect(check.changed).toBe(false);
    expect(check.markdown).toContain("L100");
  });

  it("still truncates at the default when no budget was recorded", async () => {
    const script = "for(let i=1;i<=100;i++)console.log('L'+i)";
    await record("greet", script);
    await renderReadme(await readAllSnapshots(root), { root, allowMissing: true });
    const markdown = await fs.readFile(path.join(root, "README.md"), "utf8");
    expect(markdown).toContain("... (60 more lines)");
  });
});
