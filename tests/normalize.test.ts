import { describe, expect, it } from "vitest";

import { normalizeOutput, NORMALIZER_NAMES } from "../src/normalize.js";

const CWD = "/work/project";
const HOME = "/home/dev";

function norm(text: string, extra: Record<string, unknown> = {}): string {
  return normalizeOutput(text, { cwd: CWD, homeDir: HOME, ...extra }).text;
}

describe("normalizeOutput", () => {
  it("rewrites the working directory to .", () => {
    expect(norm("scanned /work/project/src at /work/project\n")).toBe(
      "scanned ./src at .\n",
    );
  });

  it("rewrites the home directory to ~", () => {
    expect(norm("config: /home/dev/.config/app.json")).toBe("config: ~/.config/app.json");
  });

  it("replaces ISO timestamps", () => {
    expect(norm("built at 2024-05-06T07:08:09.123Z done")).toBe(
      "built at <timestamp> done",
    );
    expect(norm("built at 2024-05-06 07:08:09 done")).toBe("built at <timestamp> done");
  });

  it("replaces bare times of day", () => {
    expect(norm("started 12:34:56 end")).toBe("started <time> end");
  });

  it("replaces durations", () => {
    expect(norm("took 123ms")).toBe("took <duration>");
    expect(norm("took 1.25s")).toBe("took <duration>");
    expect(norm("waited 9 seconds")).toBe("waited <duration>");
  });

  it("replaces uuids and long hex ids", () => {
    expect(norm("id 550e8400-e29b-41d4-a716-446655440000 ok")).toBe("id <id> ok");
    expect(norm("hash 0123456789abcdef0123 ok")).toBe("hash <id> ok");
  });

  it("strips ANSI colour codes", () => {
    expect(norm("\u001b[31mred\u001b[0m plain")).toBe("red plain");
  });

  it("normalises CRLF line endings", () => {
    const result = normalizeOutput("a\r\nb\r\n", { cwd: CWD, homeDir: HOME });
    expect(result.text).toBe("a\nb\n");
    expect(result.changes.some((change) => change.rule === "lineEndings")).toBe(true);
  });

  it("normalises Windows path separators inside path tokens only", () => {
    expect(norm("copy .\\src\\a.ts to ~\\out")).toBe("copy ./src/a.ts to ~/out");
    // Prose with a backslash escape is left alone.
    expect(norm("regex \\d+ matched")).toBe("regex \\d+ matched");
  });

  it("collapses memory sizes", () => {
    expect(norm("heap 12.5 MB used")).toBe("heap <size> used");
  });

  it("reports which rules fired", () => {
    const result = normalizeOutput("took 12ms at 2024-01-02T03:04:05Z", {
      cwd: CWD,
      homeDir: HOME,
    });
    const rules = result.changes.map((change) => change.rule);
    expect(rules).toContain("isoTimestamp");
    expect(rules).toContain("duration");
  });

  it("does nothing when disabled", () => {
    const text = "took 12ms at /work/project";
    expect(normalizeOutput(text, { enabled: false }).text).toBe(text);
  });

  it("honours the disable list", () => {
    expect(norm("took 12ms", { disable: ["duration"] })).toBe("took 12ms");
  });

  it("exports the rule names in application order", () => {
    expect(NORMALIZER_NAMES[0]).toBe("ansi");
    expect(NORMALIZER_NAMES).toContain("cwd");
    expect(NORMALIZER_NAMES).toContain("duration");
  });
});
