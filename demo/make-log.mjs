#!/usr/bin/env node
/**
 * Generates a deterministic, realistic application log so the README demo can
 * be reproduced byte-for-byte on any machine.
 *
 *   node demo/make-log.mjs --lines 12000 --out demo/app.log
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
function flag(name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

const lines = Number(flag("--lines", "12000"));
const out = flag("--out", "demo/app.log");
const seed = Number(flag("--seed", "42"));

// Small deterministic PRNG (mulberry32) so the file is identical every run.
let state = seed >>> 0;
function random() {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const LEVELS = ["INFO", "INFO", "INFO", "INFO", "WARN", "ERROR"];
const STATUSES = [200, 200, 200, 200, 404, 500];
const START = Date.UTC(2025, 3, 30, 8, 0, 0);

const rows = [];
for (let i = 0; i < lines; i += 1) {
  const at = new Date(START + i * 137).toISOString();
  const level = LEVELS[Math.floor(random() * LEVELS.length)];
  const status = STATUSES[Math.floor(random() * STATUSES.length)];
  const duration = 2 + Math.floor(random() * 480);
  rows.push(
    `${at} ${level.padEnd(5)} worker-${i % 7} req=req-${100000 + i} status=${status} duration=${duration}ms`,
  );
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${rows.join("\n")}\n`, "utf8");
console.log(`wrote ${out} (${lines} lines, ${(Buffer.byteLength(rows.join("\n")) / 1024).toFixed(1)} KB)`);
