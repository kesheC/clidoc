import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ClidocError } from "../src/errors.js";
import {
  assertValidId,
  deriveId,
  listSnapshots,
  readAllSnapshots,
  readSnapshot,
  snapshotPath,
  writeSnapshot,
} from "../src/store.js";
import type { Snapshot } from "../src/types.js";

let root = "";

function snap(id: string, over: Partial<Snapshot> = {}): Snapshot {
  return {
    version: 1,
    id,
    command: "echo hi",
    argv: ["echo", "hi"],
    cwd: ".",
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "hi\n",
    stderr: "",
    env: {},
    ...over,
  };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "clidoc-store-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("assertValidId", () => {
  it("accepts ordinary ids", () => {
    expect(assertValidId("help")).toBe("help");
    expect(assertValidId("a.b-c_1")).toBe("a.b-c_1");
  });

  it("rejects empty ids", () => {
    expect(() => assertValidId("")).toThrowError(ClidocError);
  });

  it("rejects path traversal", () => {
    expect(() => assertValidId("../escape")).toThrowError(/Invalid snapshot id/);
  });

  it("rejects ids with spaces or slashes", () => {
    expect(() => assertValidId("a b")).toThrowError(ClidocError);
    expect(() => assertValidId("a/b")).toThrowError(ClidocError);
  });
});

describe("deriveId", () => {
  it("slugifies the command", () => {
    expect(deriveId(["node", "dist/cli.js", "--help"])).toBe("node-dist-cli-js-help");
  });

  it("falls back to a fixed id when nothing survives", () => {
    expect(deriveId(["---"])).toBe("snapshot");
  });

  it("truncates long commands", () => {
    const id = deriveId([Array.from({ length: 40 }, () => "word").join(" ")]);
    expect(id.length).toBeLessThanOrEqual(48);
    expect(id.endsWith("-")).toBe(false);
  });
});

describe("snapshot files", () => {
  it("writes then reads a snapshot", async () => {
    const written = await writeSnapshot(root, snap("help"));
    expect(written).toBe(snapshotPath(root, "help"));
    const loaded = await readSnapshot(root, "help");
    expect(loaded?.stdout).toBe("hi\n");
  });

  it("returns null for a missing snapshot", async () => {
    expect(await readSnapshot(root, "nope")).toBeNull();
  });

  it("rejects a corrupt snapshot", async () => {
    await fs.mkdir(path.join(root, ".clidoc"), { recursive: true });
    await fs.writeFile(path.join(root, ".clidoc", "bad.json"), "{not json", "utf8");
    await expect(readSnapshot(root, "bad")).rejects.toThrowError(/Corrupt snapshot/);
  });

  it("rejects a snapshot whose id does not match its filename", async () => {
    await fs.mkdir(path.join(root, ".clidoc"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".clidoc", "mine.json"),
      JSON.stringify(snap("other")),
      "utf8",
    );
    await expect(readSnapshot(root, "mine")).rejects.toThrowError(/declares id/);
  });

  it("lists ids in sorted order and ignores non-json files", async () => {
    await writeSnapshot(root, snap("zeta"));
    await writeSnapshot(root, snap("alpha"));
    await fs.writeFile(path.join(root, ".clidoc", "notes.txt"), "x", "utf8");
    expect(await listSnapshots(root)).toEqual(["alpha", "zeta"]);
  });

  it("returns an empty list when .clidoc does not exist", async () => {
    expect(await listSnapshots(root)).toEqual([]);
    expect(await readAllSnapshots(root)).toEqual([]);
  });

  it("reads every snapshot", async () => {
    await writeSnapshot(root, snap("a"));
    await writeSnapshot(root, snap("b"));
    expect((await readAllSnapshots(root)).map((s) => s.id)).toEqual(["a", "b"]);
  });
});
