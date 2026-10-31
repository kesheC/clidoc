import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// The release path is guarded by shell snippets that only run when somebody
// pushes a tag, which is exactly when a mistake is most expensive: a tag gate
// that does not fire uploads 0.1.6 assets under a v0.1.7 label, and a package
// assertion that looks at the wrong directory passes on an empty package.
//
// These tests run the snippets that are actually in the workflow files, so a
// typo in the YAML fails here instead of on the day of the release. Nothing is
// re-implemented: the extracted text is the shipped text.

const root = fileURLToPath(new URL("..", import.meta.url));

interface Snippet {
  /** The javascript handed to node -e. */
  source: string;
  /** Whether the closing quote carried an argument, e.g. '"$TAG"'. */
  args: string[];
}

/**
 * Pull the `run:` body of a named step out of a workflow file.
 *
 * The YAML is read as text on purpose: the only YAML parser available here
 * would be a runtime dependency, and this project ships none. A hand-rolled
 * reader is acceptable because it is checked against the real file — if the
 * workflow stops looking the way this expects, the extraction fails loudly
 * rather than returning an empty string that trivially passes.
 */
function stepBody(workflow: string, stepName: string): string {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  if (start === -1) throw new Error(`no step named "${stepName}" in the workflow`);
  const runAt = lines.findIndex((line, index) => index > start && line.trim() === "run: |");
  if (runAt === -1) throw new Error(`step "${stepName}" has no "run: |" block`);
  const indent = /^\s*/.exec(lines[runAt] ?? "")?.[0]?.length ?? 0;
  const body: string[] = [];
  for (let index = runAt + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    const depth = /^\s*/.exec(line)?.[0]?.length ?? 0;
    if (depth <= indent) break;
    body.push(line);
  }
  const text = body.join("\n");
  if (text.trim() === "") throw new Error(`step "${stepName}" has an empty run block`);
  return text;
}

/** Every `node -e` / `node --input-type=module -e` heredoc inside a step body. */
function snippets(body: string): Snippet[] {
  const lines = body.split("\n");
  const found: Snippet[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const opener = /^(\s*)node (?:--input-type=module )?-e (["'])$/.exec(lines[index] ?? "");
    if (!opener) continue;
    const indent = opener[1] ?? "";
    const quote = opener[2] ?? "'";
    const collected: string[] = [];
    let closed = false;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor] ?? "";
      const closer = new RegExp(`^${indent}${quote}(.*)$`).exec(line);
      if (closer) {
        const tail = (closer[1] ?? "").trim();
        found.push({ source: collected.join("\n"), args: tail === "" ? [] : [tail] });
        index = cursor;
        closed = true;
        break;
      }
      collected.push(line.startsWith(indent) ? line.slice(indent.length) : line.trim());
    }
    if (!closed) throw new Error("unterminated node -e snippet in the workflow");
  }
  if (found.length === 0) throw new Error("the step contains no node -e snippet");
  return found;
}

function snippetContaining(body: string, needle: string): Snippet {
  const match = snippets(body).find((snippet) => snippet.source.includes(needle));
  if (!match) throw new Error(`no node -e snippet containing "${needle}"`);
  return match;
}

const dirs: string[] = [];

function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "clidoc-workflow-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), content, "utf8");
  }
  return dir;
}

function runNode(source: string, args: string[], cwd: string): { code: number; out: string; err: string } {
  const result = spawnSync(process.execPath, ["-e", source, ...args], { cwd, encoding: "utf8" });
  return { code: result.status ?? -1, out: result.stdout ?? "", err: result.stderr ?? "" };
}

/** A package.json whose version is the single thing the gate reads. */
function packageJson(version: string): string {
  return JSON.stringify({ name: "clidoc", version }, null, 2);
}

/** The pack manifest npm emits, trimmed to the fields the assertion reads. */
function packMeta(paths: string[]): string {
  return JSON.stringify([
    {
      id: "clidoc@0.1.6",
      name: "clidoc",
      version: "0.1.6",
      size: 26244,
      unpackedSize: 79698,
      files: paths.map((entry) => ({ path: entry, size: 100 })),
    },
  ]);
}

const distEntries = [
  "LICENSE",
  "README.md",
  "dist/cli.d.ts",
  "dist/cli.js",
  "dist/errors.d.ts",
  "dist/errors.js",
  "dist/index.d.ts",
  "dist/index.js",
  "package.json",
];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const releaseYml = readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8");
const ciYml = readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");

describe("release workflow tag gate", () => {
  const publish = stepBody(releaseYml, "Publish release assets");
  const gate = snippetContaining(publish, "tag/version mismatch");

  it("runs before any gh call, so tag drift is reported as tag drift", () => {
    const text = publish;
    const gateAt = text.indexOf("tag/version mismatch");
    const firstGh = text.indexOf("gh release view");
    expect(gateAt).toBeGreaterThan(-1);
    expect(firstGh).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(firstGh);
    // The CHANGELOG extraction must come after the gate too: otherwise a
    // drifted tag fails with "CHANGELOG.md has no section for 0.1.7", which
    // sends whoever pushes the tag to the wrong file.
    expect(gateAt).toBeLessThan(text.indexOf("CHANGELOG.md has no section"));
  });

  it("accepts a tag that matches package.json", () => {
    const cwd = workspace({ "package.json": packageJson("0.1.6") });
    const result = runNode(gate.source, ["v0.1.6"], cwd);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toContain("tag v0.1.6 matches package.json version 0.1.6");
  });

  it("prints both sides and fails on a version mismatch", () => {
    const cwd = workspace({ "package.json": packageJson("0.1.6") });
    const result = runNode(gate.source, ["v0.1.7"], cwd);
    expect(result.code).toBe(1);
    expect(result.err).toContain("tag/version mismatch: tag says 0.1.7, package.json says 0.1.6");
    expect(result.out).toBe("");
  });

  it("rejects a tag that is not vX.Y.Z", () => {
    const cwd = workspace({ "package.json": packageJson("0.1.6") });
    for (const tag of ["0.1.6", "release-0.1.6", "v0.1", "v0.1.6.1", "v"]) {
      const result = runNode(gate.source, [tag], cwd);
      expect(result.code, `tag ${tag} should be rejected`).toBe(1);
      expect(result.err).toContain("tag is not a vX.Y.Z tag: " + tag);
    }
  });

  it("allows prerelease and build suffixes, which are still vX.Y.Z tags", () => {
    const cwd = workspace({ "package.json": packageJson("0.2.0-rc.1") });
    const result = runNode(gate.source, ["v0.2.0-rc.1"], cwd);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
  });
});

describe("CI package-content assertions", () => {
  const smoke = stepBody(ciYml, "Smoke test the packed tarball");
  const contents = snippetContaining(smoke, "pack-meta.json");

  it("inspects the package before leaving the repo root", () => {
    // npm pack packs the current directory. Running the check after the
    // throwaway cd would inspect that empty package and always pass.
    const packAt = smoke.indexOf("npm pack --dry-run --json");
    const cdAt = smoke.indexOf('cd "$SMOKE"');
    expect(packAt).toBeGreaterThan(-1);
    expect(cdAt).toBeGreaterThan(-1);
    expect(packAt).toBeLessThan(cdAt);
  });

  it("accepts a manifest that carries the built entry points", () => {
    const cwd = workspace({ "pack-meta.json": packMeta(distEntries) });
    const result = runNode(contents.source, [], cwd);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out.trim()).toBe("package contents ok: 9 entries, 6 under dist/");
  });

  it("fails when the tarball ships a sourcemap it cannot resolve", () => {
    const cwd = workspace({
      "pack-meta.json": packMeta([...distEntries, "dist/index.js.map"]),
    });
    const result = runNode(contents.source, [], cwd);
    expect(result.code).toBe(1);
    expect(result.err).toContain(".js.map");
  });

  it("fails when dist/ is empty instead of reporting a size heuristics win", () => {
    const cwd = workspace({
      "pack-meta.json": packMeta(["LICENSE", "README.md", "package.json"]),
    });
    const result = runNode(contents.source, [], cwd);
    expect(result.code).toBe(1);
    expect(result.err).toContain("dist/index.js is missing");
    expect(result.err).toContain("no dist/ entries at all");
  });

  it("fails when the type declarations are dropped", () => {
    const cwd = workspace({
      "pack-meta.json": packMeta(distEntries.filter((entry) => !entry.endsWith(".d.ts"))),
    });
    const result = runNode(contents.source, [], cwd);
    expect(result.code).toBe(1);
    expect(result.err).toContain("dist/index.d.ts is missing");
  });

  it("fails when src/ or tests/ leaks into the tarball", () => {
    for (const leak of ["src/index.ts", "tests/e2e.test.ts"]) {
      const cwd = workspace({ "pack-meta.json": packMeta([...distEntries, leak]) });
      const result = runNode(contents.source, [], cwd);
      expect(result.code, `${leak} should be rejected`).toBe(1);
      expect(result.err).toContain("leaks");
    }
  });

  it("imports the packed library and checks the public surface", () => {
    const library = snippetContaining(smoke, "await import('clidoc')");
    // The snippet must import the bare specifier: importing a relative path
    // would resolve to the checkout's source and verify the wrong artifact.
    expect(library.source).toContain("await import('clidoc')");
    for (const name of ["createSnapshot", "renderReadme", "normalizeOutput"]) {
      expect(library.source).toContain(name);
    }
  });
});

describe("published build", () => {
  it("turns sourcemaps off for the build that ships, but not for the editor", () => {
    const build = readFileSync(path.join(root, "tsconfig.build.json"), "utf8");
    expect(build).toMatch(/"sourceMap":\s*false/);
    expect(build).toMatch(/"declarationMap":\s*false/);
    const editor = readFileSync(path.join(root, "tsconfig.json"), "utf8");
    expect(editor).toMatch(/"sourceMap":\s*true/);
  });

  it("clears dist/ before compiling, so a stale map cannot survive", () => {
    const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    // tsc never deletes: turning sourcemaps off would leave the previous
    // build's .js.map in dist/ and npm pack would happily ship them, so the
    // build has to start from an empty directory.
    expect(manifest.scripts.build).toContain("npm run clean");
    expect(manifest.scripts.clean).toBeDefined();
    const clean = manifest.scripts.clean ?? "";
    expect(clean).toContain("rmSync");
    expect(clean).toContain("dist");
  });

  it("keeps the tarball list to what the maps would need to resolve to", () => {
    const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      files: string[];
    };
    // At least one of these must be inside "files": a .js.map points at
    // ../src/*.ts, and if src is not shipped the map is a dead link.
    const shipsSources = manifest.files.includes("dist") && manifest.files.some((entry) => entry.startsWith("src"));
    expect(shipsSources).toBe(false);
  });
});
