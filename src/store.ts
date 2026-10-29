import fs from "node:fs/promises";
import path from "node:path";

import { ClidocError } from "./errors.js";
import type { Snapshot } from "./types.js";

/** Default directory holding one JSON file per snapshot. */
export const SNAPSHOT_DIR = ".clidoc";

/** Rejects ids that would escape `.clidoc/` or break the README markers. */
export function assertValidId(id: string): string {
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new ClidocError("usage", "Snapshot id must not be empty.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new ClidocError(
      "usage",
      `Invalid snapshot id "${id}": use letters, digits, dot, dash or underscore.`,
    );
  }
  return id;
}

/** Turns a command line into a filesystem-safe snapshot id. */
export function deriveId(argv: readonly string[]): string {
  const joined = argv
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return joined.length > 0 ? joined : "snapshot";
}

export function snapshotPath(root: string, id: string): string {
  return path.join(root, SNAPSHOT_DIR, `${assertValidId(id)}.json`);
}

/** Writes the snapshot atomically (temp file + rename) and returns its path. */
export async function writeSnapshot(root: string, snapshot: Snapshot): Promise<string> {
  const target = snapshotPath(root, snapshot.id);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const body = `${JSON.stringify(snapshot, null, 2)}\n`;
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, body, "utf8");
  await fs.rename(temp, target);
  return target;
}

/** Reads one snapshot, or null when it does not exist yet. */
export async function readSnapshot(root: string, id: string): Promise<Snapshot | null> {
  const target = snapshotPath(root, id);
  let body: string;
  try {
    body = await fs.readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new ClidocError("io", `Cannot read ${target}: ${(error as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new ClidocError("snapshot", `Corrupt snapshot ${target}: ${(error as Error).message}`);
  }

  const record = parsed as Partial<Snapshot>;
  if (!record || typeof record !== "object" || typeof record.id !== "string") {
    throw new ClidocError("snapshot", `Snapshot ${target} is missing an "id" field.`);
  }
  if (typeof record.stdout !== "string" || typeof record.stderr !== "string") {
    throw new ClidocError(
      "snapshot",
      `Snapshot ${target} is missing "stdout"/"stderr" strings.`,
    );
  }
  if (record.id !== id) {
    throw new ClidocError(
      "snapshot",
      `Snapshot ${target} declares id "${record.id}", expected "${id}".`,
    );
  }
  return record as Snapshot;
}

/** Lists every snapshot id present in `.clidoc/`, sorted for stable output. */
export async function listSnapshots(root: string): Promise<string[]> {
  const dir = path.join(root, SNAPSHOT_DIR);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new ClidocError("io", `Cannot list ${dir}: ${(error as Error).message}`);
  }
  return entries
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => entry.slice(0, -".json".length))
    .sort((a, b) => a.localeCompare(b));
}

/** Reads every snapshot in the directory; throws if one is corrupt. */
export async function readAllSnapshots(root: string): Promise<Snapshot[]> {
  const ids = await listSnapshots(root);
  const snapshots: Snapshot[] = [];
  for (const id of ids) {
    const snapshot = await readSnapshot(root, id);
    if (snapshot) snapshots.push(snapshot);
  }
  return snapshots;
}
