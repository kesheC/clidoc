# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **A command that reads no arguments now rejects the ones it was given.**
  Only `run` and `record` have somewhere to put a positional argument -- they
  hand it to the child process. `render` and `list` read none, but the parser
  collected them for every command anyway, so `clidoc list extra.md` listed the
  snapshots and exited 0, and `clidoc list -- --weird` did the same. Both are
  usage errors now: ``clidoc: list does not take arguments (got "extra.md")``,
  exit 2.
- **`--flag=value` is accepted for every option that takes a value.** The
  parser only knew the two-token spelling, so `clidoc list --root=.` answered
  `unknown option "--root=. Did you mean "--root"?` -- the right guess wrapped in
  a rejection. The value is split off before the switch, which also means a
  boolean told a value (`render --check=yes`) is refused instead of quietly
  ignoring it.

## [0.1.9] - 2026-11-01

### Added

- **The README is Chinese as well as English.** All twelve sections now carry a
  Chinese paragraph directly under the English one -- same flags, same
  transcripts, same release gates. 2,427 CJK characters, up from 257.

### Fixed

- **An option a command never reads is now a usage error.** The parser accepted
  every flag on every command and then ignored the ones the chosen command did
  not consult, so `render --cwd packages/api` rendered the root tree, `list
  --readme OTHER.md` listed the wrong file's store, and `record --check`
  recorded instead of checking -- each one printing a normal success message.
  Options are now declared per command (`run` reads the union of `record` and
  `render`; `list` reads only `--root`), and a flag outside the table exits 2
  with the commands that do read it. `--help` prints the same four groups.
- **Two FAQ entries had run together**, so the second one rendered as the tail
  of the first.
- **The 0.1.8 entry overclaimed.** It listed three guards the old test lacked;
  clearing `dist/` was already covered at v0.1.7 and still is, and the other two
  were new. Version headings had no link definitions, so `[0.1.7]` and `[0.1.8]`
  rendered as literal text, and `[Unreleased]` still compared against v0.1.6.

### Quality

- 166 tests across 10 spec files, 1,765 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20 and 22.
- Zero runtime dependencies.

## [0.1.8] - 2026-11-01

### Added

- **The release gates are executed, not spell-checked.** `tests/workflow.test.ts`
  used to assert that certain strings appeared in `release.yml` and `ci.yml`.
  Each guard's own `node -e` body is now cut out of the YAML and run against
  throwaway fixtures -- the tag gate against matching, drifted, non-semver and
  prerelease tags, and ordered before the CHANGELOG lookup and before any `gh`
  call; the package-contents assertion against a complete manifest, a stray
  `.js.map`, an empty `dist/` and a leaked `src/`. 17 cases.
- **Two guards the old test did not have.** The release is re-published with
  `gh release edit --draft=false` before any upload, and the `clidoc` bin is
  smoke tested from the installed package. Neither was asserted at v0.1.7;
  the third guard, clearing `dist/`, was already covered there and still is.

## [0.1.7] - 2026-11-01

### Fixed

- **Recorded output can no longer escape its code fence.** A body line
  containing three backticks closed the fence early and left the following
  marker line outside it, so `run` wrote a README the next `render` refused
  to parse — while `run` itself still exited 0. The fence is now sized past
  the longest backtick run in the body, `<!-- clidoc:start` inside output is
  written escaped, and every render is re-parsed before it is written.
- **A typo in `--cwd` no longer renders the current directory.** `--root` and
  `--cwd` were resolved lazily where they were used, so a mistyped path fell
  back to the default and the documented CI gate turned green on the wrong
  tree. Both are now validated in `main()`, before dispatch, and a missing or
  non-directory path exits 2.
- **Unknown options are a usage error, with a suggestion.** `render --chek`
  reached the positional branch, so the writing render ran and exited 0 — one
  missing letter silently turned the `--check` gate into a rewrite. Every
  command now rejects flags outside its own table, offers the nearest name by
  edit distance, and treats a mistyped command the same way.
- **`--cwd` no longer scatters the snapshot store.** It moved both the child's
  working directory and `.clidoc/`, so recording `--cwd packages/api` wrote
  snapshots where the root `render` could not find them. `--root` decides the
  store; `--cwd` only decides where the child runs.
- **A bare `B` is no longer read as a size unit across words.** The size rule
  matched `1 B` inside `A=1 B=two` and rewrote it to `A=<size>=two`. A bare
  `B` must now touch the number; the spaced form is only accepted for the
  multi-byte units. `PATH`-shaped values collapse to `<path>`.
- **Reserved device names and README write failures are reported.** `id` now
  rejects `con`, `PRN`, `aux`, `nul`, `com1..`, `lpt1..`, so a snapshot cannot
  be written to a path Windows will not reopen; an `--env` key that looks like
  a secret is called out, because the value is copied into the snapshot and
  from there into the README; `EPERM`/`EACCES` on the README is exit 2 with
  one line instead of an uncaught error.

### Changed

- **The published tarball no longer carries dead sourcemaps.** `npm pack`
  shipped 9 `.js.map` files whose `sources` point at a `src/` the package does
  not contain, and `tsc` never deleted the previous build, so turning the maps
  off in the config was not enough. `build` now clears `dist/` first and the
  build config drops `sourceMap`/`declarationMap`: 9 maps / 30 entries /
  35316 B packed becomes 0 maps / 21 entries / 26290 B, unpacked size
  121164 B to 79805 B.

### Security

- The release job refuses to publish when the tag and `package.json`
  disagree, and the check runs before the first `gh` call, so a drifted tag is
  reported as tag drift rather than as a missing CHANGELOG section.

## [0.1.6] - 2026-11-01

### Changed

- **The install note now names the project that owns the npm name.** `clidoc` on npm belongs to [`Figmusk/clidoc`](https://github.com/Figmusk/clidoc); the README used to call it "an unrelated package" without saying which, which is a claim a reader cannot check.
- Sample transcripts in the README show the version this release actually prints.

## [0.1.5] - 2026-11-01

### Changed

- **The release page now explains the release.** The workflow used to publish a body containing only a compare link, so the one page a prospective user lands on said nothing about what changed. The body is now the `CHANGELOG.md` section for the tag, and a tag with no written section fails the job instead of shipping an empty release.

## [0.1.4] - 2026-11-01

### Changed

- **README examples showed a version the tarball no longer ships.** The released tarball bundles the README, so a stale `0.1.2` in a sample transcript was shipping to users. Every version string in it now matches the package.
- The install section documents the `clidoc.tgz.sha256` checksum every release publishes, so a download can be verified before it is executed.

## [0.1.3] - 2026-11-01

### Fixed

- **The CLI exited silently when started from an npm bin link.** The entry
  guard compared `process.argv[1]` with `import.meta.url` as raw strings. Node
  resolves `import.meta.url` to the real path but leaves `argv[1]` as written,
  so whenever the binary was reached through a link the guard was false, `main`
  never ran, and the process exited 0 having printed nothing. Every invocation
  is compared through `realpathSync` on both sides now, with a regression test
  that runs the built binary through a link and a CI step that asserts the
  printed version instead of only the exit code.

## [0.1.2] - 2026-11-01

### Added

- CI now runs `clidoc render --check`, so a README that drifts from the real
  output fails the build instead of shipping.

### Changed

- **CI runs every Node version the package claims to support.** The matrix was
  Node 20 and 22; it is now 20, 22 and 24. The floor still matches `engines`,
  and 24 is the current active LTS.
- **CI now installs the packed tarball and runs the binary from it.** Tests
  prove the source compiles; this proves the thing users download works.
- GitHub Actions moved from `checkout@v4` / `setup-node@v4` to `v5`, which runs
  on Node 24 and clears the Node 20 deprecation warning on every job.
- The README install commands point at
  `releases/latest/download/NAME.tgz` instead of a version-pinned URL, so the
  documented command keeps working across releases. Each release now uploads a
  stable-named copy next to the versioned tarball.

## [0.1.1] - 2026-10-31

### Fixed

- **Install instructions that could not work.** The README told you to run
  `npm install -g github:kesheC/clidoc`, which resolves to an SSH URL, and in
  the case of `clidoc` also implied an npm registry package that does not exist.
  Both paths are gone. The documented install path is now the release tarball,
  which is built, smoke-tested and uploaded by CI on every tag.

### Added

- `.github/workflows/release.yml`: on a `v*` tag, build, test, `npm pack`, install
  the resulting tarball in a clean directory, run the packaged binary, then upload
  the tarball and its `.sha256` to the GitHub Release.
- `SECURITY.md` with a supported-versions table, a private reporting channel and an
  explicit in-scope / out-of-scope list.
- `prepack` script, so `npm pack` always ships a freshly built `dist/`.
- `author`, `bugs` and `homepage` fields in `package.json`.

### Changed

- `engines.node` is now `>=20.11` for every release artefact, matching the oldest
  Node version the test matrix exercises.
- The build hook moved from `prepare` to `prepack`. `prepare` ran on every
  consumer's machine during install — where `devDependencies` are absent — and npm
  11 warns loudly about unreviewed install scripts, so the documented install path
  printed a warning for no benefit. The tarball now ships a prebuilt `dist/`.

### Removed

- npm registry badges and `npm install -D clidoc` snippets that pointed at an
  unrelated (or non-existent) registry package.

## [0.1.0] - 2026-10-29

### Added

- Initial release: Self-updating CLI docs: record real command output straight into your README.

- `clidoc run` executes a documented command and records its real output.
- `clidoc record` writes the recording into a Markdown file, keeping the docs in sync with the binary.
- `clidoc render` regenerates every recorded block without re-running anything.
- `clidoc list` shows the recorded commands and where they live.
- `--check` mode fails when the committed docs drift from the current output, so CI can gate documentation rot.
- Normalisation of volatile output (timings, temp paths, node versions) before comparison.
- `--readme` / `--max-lines` control which file is edited and how much output is kept.

### Quality

- 88 tests across 6 spec files, 1394 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20 and 22.
- Zero runtime dependencies.

[Unreleased]: https://github.com/kesheC/clidoc/compare/v0.1.9...HEAD
[0.1.9]: https://github.com/kesheC/clidoc/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/kesheC/clidoc/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/kesheC/clidoc/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/kesheC/clidoc/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/kesheC/clidoc/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/kesheC/clidoc/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/kesheC/clidoc/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/kesheC/clidoc/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/kesheC/clidoc/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/kesheC/clidoc/releases/tag/v0.1.0