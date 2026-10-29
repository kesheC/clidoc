import { describe, expect, it } from "vitest";

import { ClidocError } from "../src/errors.js";
import { findBlocks, firstDifference, readBlockBody, replaceBlocks } from "../src/markdown.js";

const DOC = [
  "# Title",
  "",
  "<!-- clidoc:start alpha -->",
  "stale alpha",
  "<!-- clidoc:end alpha -->",
  "",
  "<!-- clidoc:start beta -->",
  "stale beta",
  "<!-- clidoc:end beta -->",
  "",
].join("\n");

describe("findBlocks", () => {
  it("finds every marker pair in order", () => {
    const blocks = findBlocks(DOC);
    expect(blocks.map((block) => block.id)).toEqual(["alpha", "beta"]);
    expect(blocks[0]?.openLine).toBe(2);
    expect(blocks[0]?.closeLine).toBe(4);
  });

  it("returns nothing for a document without markers", () => {
    expect(findBlocks("# nothing here")).toEqual([]);
  });

  it("ignores markers quoted inside a fenced code block", () => {
    const doc = [
      "# Doc",
      "",
      "```markdown",
      "<!-- clidoc:start example -->",
      "<!-- clidoc:end example -->",
      "```",
      "",
      "<!-- clidoc:start real -->",
      "body",
      "<!-- clidoc:end real -->",
    ].join("\n");
    expect(findBlocks(doc).map((block) => block.id)).toEqual(["real"]);
  });

  it("does not mistake a tilde fence for a backtick fence", () => {
    const doc = [
      "~~~",
      "<!-- clidoc:start hidden -->",
      "~~~",
      "",
      "<!-- clidoc:start visible -->",
      "<!-- clidoc:end visible -->",
    ].join("\n");
    expect(findBlocks(doc).map((block) => block.id)).toEqual(["visible"]);
  });

  it("ignores markers that are only mentioned inline", () => {
    expect(findBlocks("Use `<!-- clidoc:start x -->` to open.")).toEqual([]);
  });

  it("throws when a start marker is never closed", () => {
    expect(() => findBlocks("<!-- clidoc:start a -->\nbody\n")).toThrowError(ClidocError);
    expect(() => findBlocks("<!-- clidoc:start a -->\n")).toThrowError(/never closed/);
  });

  it("throws when an end marker has no start", () => {
    expect(() => findBlocks("body\n<!-- clidoc:end a -->\n")).toThrowError(/no matching/);
  });

  it("throws on a mismatched pair", () => {
    expect(() =>
      findBlocks("<!-- clidoc:start a -->\n<!-- clidoc:end b -->\n"),
    ).toThrowError(/closes "a"/);
  });

  it("throws on nested markers", () => {
    expect(() =>
      findBlocks("<!-- clidoc:start a -->\n<!-- clidoc:start b -->\n"),
    ).toThrowError(/still open/);
  });

  it("throws on duplicate ids", () => {
    const doc = [
      "<!-- clidoc:start a -->",
      "<!-- clidoc:end a -->",
      "<!-- clidoc:start a -->",
      "<!-- clidoc:end a -->",
    ].join("\n");
    expect(() => findBlocks(doc)).toThrowError(/duplicate/);
  });
});

describe("readBlockBody", () => {
  it("returns the body between the markers", () => {
    expect(readBlockBody(DOC, "alpha")).toBe("stale alpha");
  });

  it("returns null for an unknown id", () => {
    expect(readBlockBody(DOC, "missing")).toBeNull();
  });
});

describe("replaceBlocks", () => {
  it("rewrites only the requested block", () => {
    const result = replaceBlocks(DOC, new Map([["alpha", "fresh alpha"]]));
    expect(result.replaced).toEqual(["alpha"]);
    expect(result.markdown).toContain("fresh alpha");
    expect(result.markdown).toContain("stale beta");
    expect(result.missing).toEqual([]);
    expect(result.unmatched).toEqual(["beta"]);
  });

  it("rewrites several blocks at once without shifting indexes", () => {
    const result = replaceBlocks(
      DOC,
      new Map([
        ["alpha", ["a1", "a2", "a3"].join("\n")],
        ["beta", "b1"],
      ]),
    );
    expect(result.replaced).toEqual(["alpha", "beta"]);
    expect(findBlocks(result.markdown).map((block) => block.id)).toEqual(["alpha", "beta"]);
    expect(result.markdown).toContain("a3");
    expect(result.markdown).toContain("b1");
  });

  it("keeps a blank line before the closing marker", () => {
    const result = replaceBlocks(DOC, new Map([["alpha", "body"]]));
    expect(result.markdown).toContain("body\n\n<!-- clidoc:end alpha -->");
  });

  it("reports snapshots that have no marker", () => {
    const result = replaceBlocks(DOC, new Map([["gamma", "x"]]));
    expect(result.missing).toEqual(["gamma"]);
    expect(result.replaced).toEqual([]);
  });

  it("is idempotent", () => {
    const once = replaceBlocks(DOC, new Map([["alpha", "same"]]));
    const twice = replaceBlocks(once.markdown, new Map([["alpha", "same"]]));
    expect(twice.markdown).toBe(once.markdown);
  });
});

describe("firstDifference", () => {
  it("returns null for identical text", () => {
    expect(firstDifference("a\nb", "a\nb")).toBeNull();
  });

  it("names the first differing line", () => {
    expect(firstDifference("a\nb", "a\nc")).toBe('line 2: README has "b", snapshot has "c"');
  });
});
