# clidoc

**Self-updating CLI docs: record the real output of a command straight into your README.**

**cli 文档自动同步：把命令的真实输出直接写回 README。**

[![CI](https://github.com/kesheC/clidoc/actions/workflows/ci.yml/badge.svg)](https://github.com/kesheC/clidoc/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Runtime dependencies: 0](https://img.shields.io/badge/runtime%20deps-0-brightgreen.svg)](#zero-runtime-dependencies)

---

## The problem / 痛点

Every README has a block like this:

```console
$ mytool --help
Usage: mytool [options]
  --fast   go faster        <-- written by hand, 14 months ago
```

Then you rename `--fast` to `--turbo`, the tests still pass, the docs lie.
Snapshot testing keeps the *assertion* honest but never touches the README;
asciinema gives you a video you cannot diff, copy or grep.

clidoc closes the loop: it **runs the command for real**, normalises the
volatile parts (paths, timings, ids), stores the result in `.clidoc/<id>.json`
and renders it between markers in your README. A CI job with `--check` fails
the build the moment the docs drift from reality.

README 里的输出示例通常是手抄的，改一次 CLI 就要手改文档，几个月后全是假的。
clidoc 把「真的跑一遍」的结果直接写回 README，并在 CI 里用 `--check` 卡住漂移。

## Install / 安装

`clidoc` is **not published to the npm registry** — the name belongs to a different
project by another author ([`Figmusk/clidoc`](https://github.com/Figmusk/clidoc)). Each
release here ships a tarball you can install directly:

```console
$ npm install -g https://github.com/kesheC/clidoc/releases/latest/download/clidoc.tgz
$ clidoc --version
0.1.6
```

Every release publishes the same tarball under a stable name (`clidoc.tgz`) alongside a
`clidoc.tgz.sha256` checksum. To verify the download before running it:

```bash
curl -sLO https://github.com/kesheC/clidoc/releases/latest/download/clidoc.tgz
curl -sLO https://github.com/kesheC/clidoc/releases/latest/download/clidoc.tgz.sha256
sha256sum -c clidoc.tgz.sha256          # clidoc.tgz: OK
npm install -g ./clidoc.tgz
```

On macOS use `shasum -a 256 -c clidoc.tgz.sha256` — there is no `sha256sum` by default.

Or as a project dev dependency:

```console
$ npm install -D https://github.com/kesheC/clidoc/releases/latest/download/clidoc.tgz
$ npx clidoc --version
0.1.6
```

Or build it from a checkout:

```console
$ git clone https://github.com/kesheC/clidoc.git && cd clidoc
$ npm ci && npm run build && npm link
$ clidoc --version
0.1.6
```

**Zero runtime dependencies** — Node.js `>=20.11` stdlib only (`node:child_process`,
`node:fs`, `node:path`). Nothing to audit, nothing to break in a lockfile bump.

> Installing straight from git (`npm install -g git+https://github.com/...`) does
> **not** work: the checkout has no build output and a global install skips
> `devDependencies`, so there is no `tsc` to build it with. Use the tarball, or
> clone and build it yourself.

## Quick start / 60 秒上手

Put a pair of markers anywhere in your README:

```markdown
<!-- clidoc:start help -->
anything here will be replaced
<!-- clidoc:end help -->
```

Then run your command through clidoc:

```console
$ clidoc run --id help -- node dist/cli.js --help
recorded help (exit 0)
rendered 1 block(s) into README.md
```

That is the whole workflow. The README now contains a fenced block with the
real stdout, and `.clidoc/help.json` holds the snapshot you can review in a PR.

## Usage / 用法

### `clidoc run <cmd...>` — record + render in one step

The command you would type 95% of the time.

```console
$ clidoc run --id help -- node dist/cli.js --help
recorded help (exit 0)
rendered 1 block(s) into README.md
```

### `clidoc record <cmd...>` — capture only

Writes `.clidoc/<id>.json` and leaves the README alone. Useful when the same
snapshot is rendered into several documents, or when you want to inspect the
raw capture before committing it.

```console
$ clidoc record --id version -- node dist/cli.js --version
recorded version (exit 0)
```

Options: `--id <name>`, `--root <dir>`, `--cwd <dir>`, `--timeout <ms>`,
`--env K=V`, `--no-normalize`, `--no-raw`, `--stamp`.

`--root` is where `.clidoc/` and the README live (default `.`); `--cwd` is the
directory the *child* runs in. They are separate on purpose: recording
`--cwd packages/api` must not scatter snapshots into `packages/api/.clidoc`.

### `clidoc render` — write the snapshots back into the README

```console
$ clidoc render
rendered 2 block(s) into README.md (no changes)
```

Flags: `--readme <file>` (default `README.md`), `--max-lines <n>` (default 40),
`--check`, `--allow-missing`.

### `clidoc render --check` — the CI gate

```console
$ clidoc render --check
README.md is up to date (2 block(s))
```

Exit code `0` means the README matches the snapshots. Exit code `1` means it is
stale (and clidoc prints the first differing line). Any other problem — broken
markers, a missing snapshot — is a `2`.

```console
$ clidoc render --check
README.md is stale: line 4: README has "hand-written, out of date", snapshot has "$ node dist/cli.js --version"
Run "clidoc render" to update it.
[exit code: 1]
```

### `clidoc list`

```console
$ clidoc list
analyze-log              ok       node demo/analyze-log.mjs demo/app.log
help                     ok       node dist/cli.js --help
```

### Scripting it

```json
{
  "scripts": {
    "docs": "clidoc run --id help -- node dist/cli.js --help",
    "docs:check": "clidoc render --check"
  }
}
```

## Real-world demo / 真实演示

The input is a **genuinely generated 12,000-line application log** (947 KB).
The log itself is not committed (it is a build artifact); the checked-in
generator below reproduces it byte-for-byte, so every reader gets the same data:

```console
$ node demo/make-log.mjs --lines 12000 --out demo/app.log
wrote demo/app.log (12000 lines, 946.6 KB)
```

Everything in this section is reproducible with one command:

```console
$ npm run demo && npm run docs && npm run docs:check
wrote demo/app.log (12000 lines, 946.6 KB)
recorded analyze-log (exit 0)
recorded help (exit 0)
rendered 2 block(s) into README.md (no changes)
README.md is up to date (2 block(s))
```

(`rendered` prints `(no changes)` the second time around. The Windows npm
banner lines are omitted above; the text in between is verbatim.)

Then `demo/analyze-log.mjs` summarises it. Compare the block the README
actually gets with the raw run below it — clidoc rewrote the wall-clock
timestamps to `<timestamp>` and every latency to `<duration>`, and left the
counts, the HTTP statuses and the error rate alone. That is the whole trick: the
volatile parts disappear, the data a reader cares about survives.

Raw run (`node demo/analyze-log.mjs demo/app.log`):

```console
$ node demo/analyze-log.mjs demo/app.log
file        demo/app.log
lines       12000
window      2025-04-30T08:00:00.000Z .. 2025-04-30T08:27:23.863Z
levels      ERROR=2067  INFO=7961  WARN=1972
statuses    200=8010  404=1993  500=1997
latency     p50=240ms p95=458ms p99=477ms max=481ms
slowest     req-102607 took 481ms
errors      5xx=1997 (16.64%)
```

Committed snapshot (what lands in the README, byte-identical on Linux CI,
macOS and Windows):

<!-- clidoc:start analyze-log -->
$ node demo/analyze-log.mjs demo/app.log
```console
file        demo/app.log
lines       12000
window      <timestamp> .. <timestamp>
levels      ERROR=2067  INFO=7961  WARN=1972
statuses    200=8010  404=1993  500=1997
latency     p50=<duration> p95=<duration> p99=<duration> max=<duration>
slowest     req-102607 took <duration>
errors      5xx=1997 (16.64%)
```

<!-- clidoc:end analyze-log -->

And here is clidoc's own help, recorded by clidoc itself (self-bootstrapped):

<!-- clidoc:start help -->
$ node dist/cli.js --help
```console
clidoc — record real CLI output straight into your README.

Usage:
  clidoc run    <cmd...>          record + render in one step (most common)
  clidoc record <cmd...>          capture a command into .clidoc/<id>.json
  clidoc render                   write .clidoc/*.json into README markers
  clidoc list                     list recorded snapshots

Options (record / run):
  --id <name>          snapshot id (default: derived from the command)
  --cwd <dir>          directory to run the command in (default: .)
  --root <dir>         project root holding .clidoc/ (default: .)
  --timeout <ms>       kill the command after N ms (default: 15000)
  --env <K=V>          extra environment variable, repeatable
  --no-normalize       keep raw output (no path/time/id rewriting)
  --no-raw             drop stdoutRaw/stderrRaw from the snapshot file
  --stamp              store durationMs and recordedAt too

Options (render / run):
  --readme <file>      README to update (default: README.md)
  --check              compare only, exit 1 when the README is stale
  --max-lines <n>      truncate code blocks after N lines (default: 40)
  --allow-missing      tolerate snapshots without markers and vice versa

Global:
  -h, --help           show this help
  -v, --version        print the version

README markers:
  &lt;!-- clidoc:start <id> -->
  ...generated, do not edit...
  &lt;!-- clidoc:end <id> -->

Argument passing:
  Everything before "--" is a clidoc option; everything after it is handed to the
  command untouched, even when it looks like a clidoc flag. A clidoc option that
  appears first still wins: --help before "--" shows this help instead of
  running anything.

Examples:
  clidoc run --id help -- node dist/cli.js --help
  clidoc record --id changelog -- git log --oneline -5
  clidoc record --id api --cwd packages/api -- npm test
  clidoc render --check          # CI gate: fails when docs drift
```

<!-- clidoc:end help -->

## How it works / 实现要点

1. **`record`** spawns the command with `node:child_process.spawn` — never a
   shell, so there is no injection surface — under a pinned environment
   (`COLUMNS=80`, `TZ=UTC`, `LANG=C.UTF-8`, `NO_COLOR=1`) with `CI`,
   `FORCE_COLOR`, `CLICOLOR` and friends scrubbed. A hard timeout kills the
   child with `SIGKILL`.
2. **`normalize`** runs a fixed chain of 13 rules over stdout and stderr:
   ANSI escapes, CRLF, trailing whitespace, a `PATH`-shaped value → `<path>`,
   working directory → `.`, home → `~`, Windows path separators, ISO timestamps
   → `<timestamp>`, `HH:MM:SS` → `<time>`, UUIDs and long hex → `<id>`,
   durations → `<duration>`, byte sizes → `<size>`. Rules are independent and
   skippable per call.
3. **`render`** finds every `<!-- clidoc:start id -->` / `<!-- clidoc:end id -->`
   pair, renders `$ command` + a `console` fence (truncating at `--max-lines`),
   and splices the new bodies in bottom-up so line indexes stay valid.

Snapshots are plain JSON (`stdout`, `stderr`, the raw variants, the argv, the
exit code and the pinned env), so a docs change shows up as a readable diff in
code review instead of an opaque binary blob.

## API

```ts
import {
  createSnapshot,   // run a command, normalise, write .clidoc/<id>.json
  normalizeOutput,  // (text, opts) => { text, changes }
  runAndCapture,    // (opts) => { stdout, stderr, exitCode, durationMs, ... }
  renderReadme,     // (snapshots, opts) => { markdown, changed, rendered, ... }
  renderSnapshot,   // (snapshot, opts) => string
  findBlocks,       // (markdown) => MarkdownBlock[]
  replaceBlocks,    // (markdown, bodies) => ReplaceBlocksResult
  readAllSnapshots, // (root) => Snapshot[]
} from "clidoc";
```

```ts
import { normalizeOutput, renderSnapshot } from "clidoc";

const { text, changes } = normalizeOutput("built at 2025-04-30T08:00:00Z in 12ms", {
  cwd: process.cwd(),
});
// text    === "built at <timestamp> in <duration>"
// changes === [{ rule: "isoTimestamp", count: 1 }, { rule: "duration", count: 1 }]

const markdown = renderSnapshot({
  version: 1,
  id: "version",
  command: "node --version",
  argv: ["node", "--version"],
  cwd: ".",
  exitCode: 0,
  signal: null,
  timedOut: false,
  stdout: "v20.11.0\n",
  stderr: "",
  env: {},
});
// "$ node --version\n\`\`\`console\nv20.11.0\n\`\`\`"
```

The library never reads `process.argv` and never calls `process.exit`; that
lives in `src/cli.ts` only.

## Zero runtime dependencies

```console
$ node -e "console.log(Object.keys(require('./package.json').dependencies ?? {}).length)"
0
```

Everything ships from `node:child_process`, `node:fs`, `node:path`,
`node:os` and `node:url`. The only `devDependencies` are TypeScript,
`@types/node` and Vitest.

## FAQ / 边界

**Does it run a shell?** No. `spawn` is called with `shell: false`, so
`clidoc run -- echo "a; rm -rf /"` is passed through literally. If you *want*
shell features (pipes, globs), run `bash -c '...'` yourself — then argv is just
`["bash", "-c", "..."]`.

**What if the command is non-deterministic?** That is exactly what the
normaliser is for. If a value is still noisy, record with `--no-normalize` to
see the raw text, then add the rule you need (or pass `disable`) rather than
hand-editing the snapshot.

**Does `render` delete output I wrote by hand inside the markers?** Yes.
Everything between a marker pair is generated. Keep prose outside the markers.

**What if a marker and a snapshot disagree?** A marker with no snapshot (or a
snapshot with no marker) is an error, exit 2, and both sides are named:

```console
$ clidoc render --check
clidoc: marker(s) with no recorded snapshot: ghost. Fix the markers or pass --allow-missing.
[exit code: 2]
```

`--allow-missing` downgrades that to a `warning:` line, which is handy while you
are still writing the docs. A **stale** README is the other, happier failure:
exit 1, and clidoc prints the first line that differs:

```console
$ clidoc render --check
README.md is stale: line 4: README has "hand-written, out of date", snapshot has "$ node dist/cli.js --version"
Run "clidoc render" to update it.
[exit code: 1]
```

**What does a broken marker look like?** clidoc refuses to guess:

```console
$ clidoc render --check
clidoc: "clidoc:start version" (line 1) is never closed.
[exit code: 2]
```

**What if my command prints a code fence or clidoc's own markers?** clidoc
refuses to break itself. A body containing backtick runs gets a longer fence
(` ````console ` rather than ` ```console `), and any `<!-- clidoc:start` in the
output is written as `&lt;!-- clidoc:start` so it can never become a real marker.
As a backstop, `record`/`run` re-parse what they are about to write and abort
with exit `2` instead of writing a README clidoc cannot read back.

**Can the recorded command read stdin?** No. The child is spawned with
`stdio: ["ignore", "pipe", "pipe"]`, so its stdin is `/dev/null`; a command that
only produces output when fed input will record an empty body.

**Does the recorded command see my environment?** Only a small whitelist
(`PATH`, `HOME`, `TMPDIR`, `SystemRoot` on Windows, …) plus `--env K=V` pairs,
with colour and CI variables scrubbed. `--env` values are written into the JSON
snapshot verbatim, so clidoc warns when a key looks like a secret.

**Does it work on Windows?** Yes — that is the platform it was developed on.
`spawn` is shell-free and paths go through `node:path`. Line endings are
handled too: clidoc detects whether your README uses LF or CRLF and writes back
in the same style, so a checkout with `core.autocrlf=true` does not produce a
phantom `--check` failure. (`.gitattributes` pins `eol=lf` anyway, so CI and a
fresh clone see the same bytes.)

**Does it edit files other than the README?** No. `record`/`run` add one JSON
file under `.clidoc/`; `render` writes only `--readme`.

**What does NOT get normalised?** Counts, exit codes, versions and anything
else that is stable for a given commit. Note the trade-off visible in the demo
above: `240ms` becomes `<duration>` because a latency *is* volatile between
machines, so the README shows the shape of the data (`p95=<duration>`) rather
than a number that would fail `--check` on a slower CI runner. When you need
the real number in the docs, print only the stable part (or record that block
with `--no-normalize`) and let the volatile part live in a benchmark file.

The full rule list is `NORMALIZER_NAMES`, exported from `clidoc`:
`ansi`, `lineEndings`, `trailingWhitespace`, `pathList`, `cwd`, `home`,
`pathSeparators`, `isoTimestamp`, `dateTime`, `uuid`, `hexId`, `duration`, `size`.

## Security and changes / 安全与变更

Found a vulnerability? Please do not open a public issue — [SECURITY.md](SECURITY.md)
explains the private reporting channel and what to include. Every release is written
up in [CHANGELOG.md](CHANGELOG.md).

## License

MIT © 2026 kesheC — see [LICENSE](LICENSE).