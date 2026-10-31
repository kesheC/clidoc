# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- `prepare` script so a checkout builds itself on install.
- `author`, `bugs` and `homepage` fields in `package.json`.

### Changed

- `engines.node` is now `>=20.11` for every release artefact, matching the oldest
  Node version the test matrix exercises.

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

[Unreleased]: https://github.com/kesheC/clidoc/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/kesheC/clidoc/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/kesheC/clidoc/releases/tag/v0.1.0
