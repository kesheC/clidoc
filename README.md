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
0.1.12
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
0.1.12
```

Or build it from a checkout:

```console
$ git clone https://github.com/kesheC/clidoc.git && cd clidoc
$ npm ci && npm run build && npm link
$ clidoc --version
0.1.12
```

**Zero runtime dependencies** — Node.js `>=20.11` stdlib only (`node:child_process`,
`node:fs`, `node:path`). Nothing to audit, nothing to break in a lockfile bump.

> Installing straight from git (`npm install -g git+https://github.com/...`) does
> **not** work: the checkout has no build output and a global install skips
> `devDependencies`, so there is no `tsc` to build it with. Use the tarball, or
> clone and build it yourself.

中文：clidoc **没有发布到 npm 官方源**——`clidoc` 这个包名属于另一位作者的
[`Figmusk/clidoc`](https://github.com/Figmusk/clidoc)。所以每个 release 都附带一份可以直接
安装的 tarball：上面三段分别是全局安装、作为项目 devDependency，以及从仓库自己构建，
装完之后 `clidoc --version` 应当输出 `0.1.12`。

每次发布都在固定文件名 `clidoc.tgz` 下上传同一份 tarball，并附 `clidoc.tgz.sha256` 校验和；
想在安装前先校验，就用上面那两条 `curl` 把两个文件下载下来，Linux 上跑
`sha256sum -c clidoc.tgz.sha256`，macOS 默认没有 `sha256sum`，改用
`shasum -a 256 -c clidoc.tgz.sha256`，看到 `clidoc.tgz: OK` 再去安装。

**运行时依赖为 0**：只用到 Node.js `>=20.11` 的标准库（`node:child_process`、`node:fs`、
`node:path`），没有第三方代码要审计，也不会因为升了一次 lockfile 就崩。

注意：直接从 git 装（`npm install -g git+https://github.com/...`）是**不行**的。
仓库里没有构建产物，而全局安装会跳过 `devDependencies`，也就没有 `tsc` 去编译它。
请用 tarball，或者 clone 下来自己 build。

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

中文：在 README 里随便找一处放一对 marker：`<!-- clidoc:start help -->` 与
`<!-- clidoc:end help -->`，中间先写点占位内容也无所谓。然后用 clidoc 跑一遍要记录的命令，
也就是上面那条 `clidoc run --id help -- node dist/cli.js --help`：它真的执行命令，把结果写进
`.clidoc/help.json`，再把这一对 marker 之间的内容替换成一行 `$ 命令行` 加一个 `console` 代码块，
终端打印 `recorded help (exit 0)` 与 `rendered 1 block(s) into README.md`。
整条工作流就这么多——README 里从此是真实输出，而 `.clidoc/help.json` 是一份能在 code review
里逐行看的快照。

## Usage / 用法

Options take their value as the next word or after an equals sign:
`--root=.` is `--root .`. A boolean option given a value
(`render --check=yes`) is a usage error, not a silent no-op.

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
A typo in the flag can never turn the gate green: unknown options are rejected
before anything runs, so `render --chek` exits `2` and leaves the README
untouched instead of silently doing a normal (writing) render.

```console
$ clidoc render --chek
clidoc: unknown option "--chek". Did you mean "--check"?
[exit code: 2]
```

Options are also declared per command, so a flag the chosen command never reads
is a usage error instead of a silent no-op. `record` reads the capture flags,
`render` reads the rendering flags, `run` reads both, and `list` reads only
`--root`:

```console
$ clidoc list --max-lines 5
clidoc: `list` does not read --max-lines; it applies to record, render and run. Run "clidoc --help" to list the options per command.
[exit code: 2]
```
The same rule covers positional arguments. Only `run` and `record` have
somewhere to put one -- they hand it to the child process. `render` and `list` read
none, so naming one is a usage error instead of a silent drop:

```console
$ clidoc list extra.md
clidoc: list does not take arguments (got "extra.md"). Run "clidoc --help" to list the options per command.
[exit code: 2]
```

`clidoc list -- --weird` gets the same answer: `--` changes what counts as an
option, not which commands take arguments.

The same applies to `--root` and `--cwd`: if you name a directory that does not
exist, every command stops with `2` instead of quietly using the default.

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

`--version` is a request about the tool, not about the run, so it is answered only at the top level:

```console
$ clidoc list --version
clidoc: --version is not supported by `list`; it applies to "clidoc --version" on its own.
[exit code: 2]
```

中文：本节四个命令，一句话各自对应上面的英文小节。

`clidoc run` 是最常用的那条：录一次、顺手渲染进 README，等于 `record` + `render`。

`clidoc record` 只录不渲染——只写 `.clidoc/<id>.json`，README 一个字都不动。同一份快照要渲染进
多份文档，或者你想先看看原始捕获再决定要不要提交时，用它。选项是 `--id`、`--root`、`--cwd`、
`--timeout`、`--env K=V`、`--no-normalize`、`--no-raw`、`--stamp`。其中 `--root` 决定 `.clidoc/`
与 README 的位置（默认当前目录），`--cwd` 只决定**子进程**在哪个目录里跑，两者是故意分开的：
`--cwd packages/api` 不会把快照散落到 `packages/api/.clidoc` 去。

`clidoc render` 把已有快照写回 README 的 marker 之间，选项是 `--readme`（默认 `README.md`）、
`--max-lines`（默认 40）、`--check`、`--allow-missing`。

`clidoc render --check` 是 CI 闸门：README 与快照一致时退出码 `0`；过期（文档漂移）时退出码 `1`
并打印第一处不同的行；其它问题——marker 坏了、缺快照——一律 `2`。选项拼错**绝不可能**让闸门变绿：
未知选项在真正执行之前就被拒绝，所以 `render --chek` 是退出 `2` 且 README 原封不动，
而不是悄悄退化成一次会写盘的正常 render。

选项还是**按命令**声明的：某个命令根本不读的选项是用法错误（退出 `2`），而不是悄悄吞掉。
`record` 读捕获类选项，`render` 读渲染类选项，`run` 两类都读，`list` 只读 `--root`：

```console
$ clidoc list --max-lines 5
clidoc: `list` does not read --max-lines; it applies to record, render and run. Run "clidoc --help" to list the options per command.
[exit code: 2]
```
位置参数同理：只有 `run` 与 `record` 有地方安放它（交给子进程），
`render` 与 `list` 一个都不读，点名就是用法错误，而不是悄悄丢掉：

```console
$ clidoc list extra.md
clidoc: list does not take arguments (got "extra.md"). Run "clidoc --help" to list the options per command.
[exit code: 2]
```

同理，`--root` 与 `--cwd` 指向不存在的目录时，
四个命令都会以 `2` 停下，不会默默退回默认值。

`--version` 问的是工具本身，不是这次运行，所以只在顶层回答：

```console
$ clidoc list --version
clidoc: --version is not supported by `list`; it applies to "clidoc --version" on its own.
[exit code: 2]
```

`clidoc list` 列出已录的快照：id、状态，以及当初那条命令。

最后那一小块是把它挂进 `package.json` 的写法：`docs` 负责录，`docs:check` 负责在 CI 里卡漂移。

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

Options (record only):
  --id <name>          snapshot id (default: derived from the command)
  --cwd <dir>          directory the command runs in (default: .)
  --timeout <ms>       kill the command after N ms (default: 15000)
  --env <K=V>          extra environment variable, repeatable
  --no-normalize       keep raw output (no path/time/id rewriting)
  --no-raw             drop stdoutRaw/stderrRaw from the snapshot file
  --stamp              store durationMs and recordedAt too

Options (render only):
  --readme <file>      README to update (default: README.md)
  --check              compare only, exit 1 when the README is stale
  --allow-missing      tolerate snapshots without markers and vice versa

Options (record and render, so also run):
  --max-lines <n>      truncate code blocks after N lines (default: 40)

Global (every command):
  --root <dir>         project root holding .clidoc/ (default: .)
  -h, --help           show this help
  -v, --version        print the version (top level only)

An option the chosen command does not read is a usage error (exit 2) rather
than a silent no-op: `clidoc list --max-lines 5` is rejected, not ignored.

README markers:
  &lt;!-- clidoc:start <id> -->
  ...generated, do not edit...
  &lt;!-- clidoc:end <id> -->

Argument passing:
  Everything before "--" is a clidoc option; everything after it is handed to the
  command untouched, even when it looks like a clidoc flag. A clidoc option that
  appears first still wins: --help before "--" shows this help instead of
  running anything.

Positional arguments:
  run and record hand them to the command. render and list take none, so
  passing one is a usage error rather than a silent no-op.

Examples:
  clidoc run --id help -- node dist/cli.js --help
  clidoc record --id changelog -- git log --oneline -5
  clidoc record --id api --cwd packages/api -- npm test
  clidoc render --check          # CI gate: fails when docs drift
```

<!-- clidoc:end help -->

中文：这一节的全部内容，一条命令就能复现：`npm run demo && npm run docs && npm run docs:check`
（生成日志 → 录制并渲染 → 校验）。输入是**真的生成出来的 12,000 行应用日志**（946.6 KB）；
日志本身不入库（它是构建产物），但仓库里带着生成脚本，同一个种子保证每个读者拿到逐字节一样的数据。
`rendered` 第二次运行会打印 `(no changes)`，而上面输出里省略了 Windows 下 npm 的那几行横幅，
中间的文字是逐字照抄的。

`demo/analyze-log.mjs` 负责统计这份日志。把它下面的「原始运行」和「README 里实际得到的那块」比一比：
clidoc 把 wall-clock 时间戳换成了 `<timestamp>`、把每个延迟换成了 `<duration>`，而计数、HTTP 状态码、
错误率原样保留。这就是全部把戏——会变的消失，读者真正关心的数据留下。

再往下两块，一块是 12,000 行日志的真实统计结果，一块是 clidoc 用自己的 `--help` 录给自己的输出
（自举：`clidoc run --id help -- node dist/cli.js --help`）。这两块之间的内容是 clidoc 生成的，
不要手改；改了就 `render --check` 变红。

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

中文：三步。

一，**`record`** 用 `node:child_process.spawn` 起进程——从不经过 shell，所以没有注入面——
并在一个钉死的环境里跑（`COLUMNS=80`、`TZ=UTC`、`LANG=C.UTF-8`、`NO_COLOR=1`），
同时把 `CI`、`FORCE_COLOR`、`CLICOLOR` 这些变量抹掉；超时到点用 `SIGKILL` 杀子进程。

二，**`normalize`** 对 stdout 与 stderr 跑一条固定的 13 条规则链：ANSI 转义、CRLF、行尾空白、
`PATH` 形状的值 → `<path>`、工作目录 → `.`、家目录 → `~`、Windows 路径分隔符、
ISO 时间戳 → `<timestamp>`、`HH:MM:SS` → `<time>`、UUID 与长十六进制 → `<id>`、
时长 → `<duration>`、字节大小 → `<size>`。规则彼此独立，单次调用可以被关掉。

三，**`render`** 找出每一对 `<!-- clidoc:start id -->` 与 `<!-- clidoc:end id -->`，生成
`$ 命令行` 加一个 `console` 代码块（超过 `--max-lines` 就截断），并**自下而上**拼接回去，
这样前面的替换不会让后面的行号失效。

快照就是普通 JSON（`stdout`、`stderr`、各自的原始版本、argv、退出码，以及那份钉死的 env），
所以一次文档改动在 code review 里是一条能读的 diff，而不是一块看不懂的二进制。

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

中文：第一块是包对外导出的八个函数——`createSnapshot` 跑命令、归一化、写 `.clidoc/<id>.json`；
`normalizeOutput` 返回 `{ text, changes }`；`runAndCapture` 只跑命令并返回结果；
`renderReadme` 渲染整份 README；`renderSnapshot` 把单个快照渲染成 Markdown 片段；
`findBlocks` 解析 marker；`replaceBlocks` 替换块内容；`readAllSnapshots` 读出全部快照。

第二块是用法示例：`normalizeOutput("built at 2025-04-30T08:00:00Z in 12ms", ...)` 返回的 `text`
是 `built at <timestamp> in <duration>`，`changes` 记录了哪条规则命中了几次；`renderSnapshot`
拿到一个快照对象，返回 `$ node --version` 加一个 `console` 代码块。

库本身从不读 `process.argv`、从不调 `process.exit`——那些只存在于 `src/cli.ts`。

## Zero runtime dependencies

```console
$ node -e "console.log(Object.keys(require('./package.json').dependencies ?? {}).length)"
0
```

Everything ships from `node:child_process`, `node:fs`, `node:path`,
`node:os` and `node:url`. The only `devDependencies` are TypeScript,
`@types/node` and Vitest.

中文：`package.json` 的 `dependencies` 是空的，上面那条 `node -e` 打印 `0` 就是证明。
代码只用到 `node:child_process`、`node:fs`、`node:path`、`node:os`、`node:url` 五个标准库模块；
`devDependencies` 也只有 TypeScript、`@types/node` 和 Vitest 三项。没有可审计的第三方代码，
也没有会因为 lockfile 升级而改变的运行时。

## Release pipeline / 发布链路

A docs tool that publishes a broken tarball is worse than useless, so the release
path is guarded by `node -e` snippets that run *before* anything is uploaded.
Because that code only executes on a tag push, it is the easiest thing to have
subtly wrong — so it is also tested. `scripts/extract-workflow-step.py` prints a
step body verbatim (`--local` maps the GitHub expressions onto shell variables):

```console
$ python scripts/extract-workflow-step.py .github/workflows/release.yml "Publish release assets" | head -3
set -euo pipefail
TARBALL="${{ steps.pack.outputs.tarball }}"
# --- tag/version gate ---
```

**1. The tag gate.** Releases are tag-driven, so the tag is the only thing naming
the version. Without a gate, a `v0.1.11` tag on a `0.1.10` tree uploads 0.1.10
assets under a 0.1.11 label. Running the real extracted body with a drifted tag
stops before the first `gh` call — `RELEASE_NOTES.md` is never even written:

```console
$ TAG=v0.1.11 bash publish.sh
tag/version mismatch: tag says 0.1.11, package.json says 0.1.10
exit 1
notes: not written
```

With a matching tag the gate passes and the next step proceeds — here it is a
`gh` call that fails only because this local run used a dummy token:

```console
$ TAG=v0.1.12 bash publish.sh
tag v0.1.12 matches package.json version 0.1.12
HTTP 401: Bad credentials (https://api.github.com/repos/kesheC/clidoc/releases)
exit 1
```

**2. Package contents, checked from the repo root.** `npm pack --dry-run --json`
runs before any `cd`: packing from a throwaway directory would inspect *that*
empty package and pass forever. The extracted CI smoke step, run locally against
the real repo:

```console
$ bash smoke.sh | grep -E "package contents ok|clidoc --version =|library import ok"
package contents ok: 21 entries, 18 under dist/
clidoc --version = 0.1.12 (expected 0.1.12)
library import ok, 28 exports
exit 0
```

The same assertion fails loudly on a rotten artifact. Here `npm pack` was pointed
at a package root that has no `dist/` (`npm pack --dry-run --json --ignore-scripts`,
so the missing build is not regenerated), and every problem is reported at once:

```console
$ node assert.cjs
dist/index.js is missing from the tarball
dist/cli.js is missing from the tarball
dist/index.d.ts is missing, so the types do not ship
the tarball has no dist/ entries at all
exit 1
```

**3. What the tarball does *not* contain.** The published build turns sourcemaps
off (`tsconfig.build.json`): the tarball ships only `dist/`, so a `.js.map` would
point at `src/*.ts` that is not in it. `npm run build` also clears `dist/` first,
because `tsc` leaves the previous build's files in place — otherwise turning maps
off would still ship the maps from the last build:

```console
$ npm run build && npm pack --dry-run --json
0 sourcemaps, 21 entries in the tarball
```

**4. Those snippets are themselves tested.** `tests/workflow.test.ts` extracts the
real `node -e` bodies out of the YAML and runs them against fixture manifests,
positive and negative, so a typo in the workflow fails on a laptop instead of on
release day. It also pins the parts that are easy to lose in a rewrite: the
release is re-published with `gh release edit --draft=false` before any upload,
every `bin` in `package.json` is smoke tested, and `npm run build` still clears
`dist/` first. 17 cases.

中文：发布链路上有两道闸门，都只在打 tag 时才执行，所以最容易写错也最难当场发现。
第一道比对 tag 与 `package.json` 的版本，不一致就在任何 `gh` 调用之前退出 1，
避免新 tag 悄悄上传旧版本的产物；第二道在仓库根目录解析
`npm pack --dry-run --json`，断言 `dist` 入口齐全、没有泄漏 `src/` 与 `tests/`、
没有指向不存在源文件的 sourcemap，并把打出来的包装进临时目录再 import 一次库。
这些片段由 `tests/workflow.test.ts` 从 YAML 里原样抽出来跑，正反例都有，
所以 YAML 里写错一个字符会在本地就红，而不是等到发版当天。

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

**What happens to an option I misspell?** `clidoc` exits `2` and names the
closest real option (`unknown option "--chek". Did you mean "--check"?`). It
never guesses and never runs the command without the flag you meant — a CI gate
that silently degrades to a writing `render` is worse than a red one.

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

中文：这一节按问题逐条对应上面的英文回答。

**会不会执行 shell？** 不会。`spawn` 带的是 `shell: false`，所以
`clidoc run -- echo "a; rm -rf /"` 里的分号只是普通字符，原样传给 `echo`。
真要用管道、通配符这类 shell 特性，自己写成 `bash -c '...'`，此时 argv 就是
`["bash", "-c", "..."]`。

**命令输出不确定怎么办？** 这正是归一化存在的理由。如果某个值仍然在抖，先用 `--no-normalize`
录一次看原文，然后补一条你需要的规则（或者传 `disable`），而不是手改快照。

**marker 之间我手写的内容会被删掉吗？** 会。一对 marker 之间的内容全部由 clidoc 生成，
散文请写在 marker 外面。

**marker 与快照对不上呢？** 有 marker 没快照（或反过来）是错误，退出码 `2`，并且两侧都点名：
`clidoc: marker(s) with no recorded snapshot: ghost. Fix the markers or pass --allow-missing.`
加 `--allow-missing` 会把它降级成一行 `warning:`，文档还没写完时很有用。另一种「更好的失败」是
README **过期**：退出码 `1`，并打印第一处不同的行。marker 本身写坏（比如只有 start 没有 end）时
clidoc 不猜，直接报 `"clidoc:start version" (line 1) is never closed.` 并以 `2` 退出。

**命令输出里带代码围栏、或者带 clidoc 自己的 marker 呢？** clidoc 不会把自己弄坏。正文里出现连续
反引号时，它改用更长的围栏（` ````console ` 而不是 ` ```console `）；输出里出现
`<!-- clidoc:start` 会被写成 `&lt;!-- clidoc:start`，永远成不了真 marker。兜底还有一层：
`record`/`run` 在写盘之前会把自己即将写入的 README 重新解析一遍，解析不过就以退出码 `2` 中止，
不会写出 clidoc 自己都读不回来的 README。

**被录的命令能读 stdin 吗？** 不能。子进程用 `stdio: ["ignore", "pipe", "pipe"]` 起，stdin 是
`/dev/null`，所以那些只有喂了输入才有输出的命令会录到空正文。

**被录的命令能看到我的环境变量吗？** 只看到一份很小的白名单（`PATH`、`HOME`、`TMPDIR`，
Windows 上还有 `SystemRoot` 等），加上 `--env K=V` 给的键值对，颜色与 CI 相关变量会被抹掉。
`--env` 的值会原样写进 JSON 快照，所以键名看起来像密钥时 clidoc 会警告。

**Windows 上能用吗？** 能，它就是在 Windows 上开发的。`spawn` 不经过 shell，路径全走 `node:path`。
换行也处理了：clidoc 会看你的 README 用的是 LF 还是 CRLF，并按同样风格写回，所以
`core.autocrlf=true` 的检出不会出现假的 `--check` 失败（何况 `.gitattributes` 已把 `eol=lf` 钉死，
CI 与全新 clone 看到的是同样的字节）。

**除了 README 还会改别的文件吗？** 不会。`record`/`run` 只往 `.clidoc/` 加一个 JSON 文件，
`render` 只写 `--readme` 指定的那个文件。

**选项拼错了呢？** 退出 `2`，并给出最接近的真实选项
（`unknown option "--chek". Did you mean "--check"?`）。它从不猜，也从不带着一个你没写全的 flag
去执行命令——一个会悄悄退化成「会写盘的 render」的 CI 闸门，比红着还糟。

**什么不会被归一化？** 计数、退出码、版本号，以及任何对一个 commit 来说稳定的值。注意上面演示里
那个取舍：`240ms` 会变成 `<duration>`，因为延迟在不同机器上本来就会变，所以 README 展示的是数据的
形状（`p95=<duration>`），而不是一个在慢一点的 CI 机器上就会让 `--check` 变红的数字。真要把数字写进
文档，就只打印稳定的那部分，或者对那块用 `--no-normalize` 录，把会变的部分放到 benchmark 文件里。

完整的规则清单是从 `clidoc` 导出的 `NORMALIZER_NAMES`：`ansi`、`lineEndings`、
`trailingWhitespace`、`pathList`、`cwd`、`home`、`pathSeparators`、`isoTimestamp`、`dateTime`、
`uuid`、`hexId`、`duration`、`size`。

## Security and changes / 安全与变更

Found a vulnerability? Please do not open a public issue — [SECURITY.md](SECURITY.md)
explains the private reporting channel and what to include. Every release is written
up in [CHANGELOG.md](CHANGELOG.md).

中文：发现安全问题请不要开公开 issue——[SECURITY.md](SECURITY.md) 说明了私下上报的渠道，
以及报告里需要写清哪些信息。每一次发布都会记录在 [CHANGELOG.md](CHANGELOG.md)。

## License

MIT © 2026 kesheC — see [LICENSE](LICENSE).

中文：MIT 许可，版权归 2026 kesheC 所有，详见 [LICENSE](LICENSE)。
