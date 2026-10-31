import { describe, expect, it } from "vitest";

import { ClidocError } from "../src/errors.js";
import { findBlocks } from "../src/markdown.js";
import { assertSelfParseable, renderBlocks, renderSnapshot } from "../src/render.js";
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

  // B1: a body line made of backticks used to close the fence early.
  it("lengthens the fence past any backtick run in the body", () => {
    const out = renderSnapshot(snap({ stdout: "before\n\n```\ninjected\n```" }));
    const lines = out.split("\n");
    expect(lines[1]).toBe("````console");
    expect(lines.at(-1)).toBe("````");
  });

  it("keeps a three-backtick fence when the body has none", () => {
    const body = renderSnapshot(snap({ stdout: "plain" })).split("\n");
    expect(body[1]).toBe("```console");
  });

  it("outruns a five-backtick run, not just three", () => {
    const body = renderSnapshot(snap({ stdout: "`````" })).split("\n");
    expect(body[1]).toBe("``````console");
  });

  // B2: marker syntax in the output must not become a real marker.
  it("escapes marker syntax so it cannot open a ghost block", () => {
    const out = renderSnapshot(
      snap({ stdout: "<!-- clidoc:start ghost -->\nbody\n<!-- clidoc:end ghost -->" }),
    );
    expect(out).not.toContain("<!-- clidoc:start ghost");
    expect(out).toContain("&lt;!-- clidoc:start ghost");
    expect(() => findBlocks(out)).not.toThrow();
  });

  it("leaves ordinary HTML comments alone", () => {
    expect(renderSnapshot(snap({ stdout: "<!-- keep me -->" }))).toContain("<!-- keep me -->");
  });

  // M3: the recorded budget wins over the caller's flag and the default.
  it("honours maxLines stored on the snapshot", () => {
    const stdout = Array.from({ length: 100 }, (_, i) => `L${i + 1}`).join("\n");
    const out = renderSnapshot(snap({ stdout, maxLines: 200 }), { maxLines: 5 });
    expect(out).toContain("L100");
    expect(out).not.toContain("more lines");
  });

  it("falls back to the caller's flag when the snapshot has no budget", () => {
    const stdout = Array.from({ length: 100 }, (_, i) => `L${i + 1}`).join("\n");
    expect(renderSnapshot(snap({ stdout }), { maxLines: 3 })).toContain("... (97 more lines)");
  });
});

describe("assertSelfParseable", () => {
  it("accepts markdown whose blocks are well formed", () => {
    const md = [
      "# t",
      "<!-- clidoc:start a -->",
      renderSnapshot(snap({ id: "a" })),
      "<!-- clidoc:end a -->",
    ].join("\n");
    expect(() => assertSelfParseable(md, ["a"])).not.toThrow();
  });

  // Guard for the failure mode where the rendered body escapes its fence and
  // leaves a nested marker pair behind.
  it("rejects a document with a nested marker pair", () => {
    const md = [
      "<!-- clidoc:start a -->",
      "<!-- clidoc:start ghost -->",
      "<!-- clidoc:end ghost -->",
      "<!-- clidoc:end a -->",
    ].join("\n");
    expect(() => assertSelfParseable(md, ["a"])).toThrowError(/Refusing to write/);
  });

  it("rejects a document with an unclosed block", () => {
    expect(() => assertSelfParseable("<!-- clidoc:start a -->\ntext", ["a"])).toThrowError(
      /Refusing to write/,
    );
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
