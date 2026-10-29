import { describe, expect, it } from "vitest";

import { ClidocError } from "../src/errors.js";
import { renderBlocks, renderSnapshot } from "../src/render.js";
import type { Snapshot } from "../src/types.js";

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    version: 1,
    id: "demo",
    command: "node --version",
    argv: ["node", "--version"],
    cwd: ".",
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "v20.11.0\n",
    stderr: "",
    env: {},
    ...over,
  };
}

describe("renderSnapshot", () => {
  it("renders a $ line and a console fence", () => {
    expect(renderSnapshot(snap())).toBe(
      ["$ node --version", "```console", "v20.11.0", "```"].join("\n"),
    );
  });

  it("includes stderr after stdout", () => {
    const out = renderSnapshot(snap({ stderr: "warn\n" }));
    expect(out).toContain("v20.11.0\nwarn");
  });

  it("can drop stderr", () => {
    const out = renderSnapshot(snap({ stderr: "warn\n" }), { includeStderr: false });
    expect(out).not.toContain("warn");
  });

  it("appends the exit code when the command failed", () => {
    expect(renderSnapshot(snap({ exitCode: 1 }))).toContain("[exit code: 1]");
  });

  it("notices a signal kill", () => {
    expect(renderSnapshot(snap({ exitCode: null, signal: "SIGKILL" }))).toContain(
      "[killed by SIGKILL]",
    );
  });

  it("truncates long output and says how many lines were hidden", () => {
    const stdout = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");
    const out = renderSnapshot(snap({ stdout }), { maxLines: 5 });
    expect(out).toContain("line 5");
    expect(out).not.toContain("line 6");
    expect(out).toContain("... (45 more lines)");
  });

  it("uses the singular for exactly one hidden line", () => {
    const out = renderSnapshot(snap({ stdout: "a\nb" }), { maxLines: 1 });
    expect(out).toContain("... (1 more line)");
  });

  it("renders an empty body when the command prints nothing", () => {
    expect(renderSnapshot(snap({ stdout: "", stderr: "" }))).toBe(
      ["$ node --version", "```console", "```"].join("\n"),
    );
  });

  it("rejects a non-positive maxLines", () => {
    expect(() => renderSnapshot(snap(), { maxLines: 0 })).toThrowError(ClidocError);
  });
});

describe("renderBlocks", () => {
  it("keys bodies by snapshot id", () => {
    const bodies = renderBlocks([snap({ id: "a" }), snap({ id: "b" })]);
    expect([...bodies.keys()]).toEqual(["a", "b"]);
  });

  it("rejects duplicate ids", () => {
    expect(() => renderBlocks([snap({ id: "a" }), snap({ id: "a" })])).toThrowError(/Duplicate/);
  });
});
