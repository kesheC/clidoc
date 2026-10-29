#!/usr/bin/env node
/**
 * Summarises an application log. Used as the real-world input for the clidoc
 * README demo — it deliberately prints volatile things (timestamps, durations,
 * request ids) so you can see what the normaliser rewrites.
 *
 *   node demo/analyze-log.mjs demo/app.log
 */
import fs from "node:fs";

const file = process.argv[2];
if (file === undefined) {
  console.error("usage: node demo/analyze-log.mjs <logfile>");
  process.exit(2);
}

let text;
try {
  text = fs.readFileSync(file, "utf8");
} catch (error) {
  console.error(`cannot read ${file}: ${error.message}`);
  process.exit(1);
}

const rows = text.split("\n").filter((line) => line.length > 0);
const levels = new Map();
const statuses = new Map();
const durations = [];
let first = null;
let last = null;
let slowest = null;

for (const row of rows) {
  const match = /^(\S+) (\w+)\s+worker-\d+ req=(\S+) status=(\d+) duration=(\d+)ms$/.exec(row);
  if (!match) continue;
  const [, at, level, requestId, status, duration] = match;
  levels.set(level, (levels.get(level) ?? 0) + 1);
  statuses.set(status, (statuses.get(status) ?? 0) + 1);
  const ms = Number(duration);
  durations.push(ms);
  if (first === null || at < first) first = at;
  if (last === null || at > last) last = at;
  if (slowest === null || ms > slowest.ms) slowest = { ms, requestId };
}

durations.sort((a, b) => a - b);
const percentile = (p) => durations[Math.floor((durations.length - 1) * p)] ?? 0;
const errors = [...statuses.entries()].filter(([status]) => status.startsWith("5"));
const errorCount = errors.reduce((sum, [, count]) => sum + count, 0);

console.log(`file        ${file}`);
console.log(`lines       ${rows.length}`);
console.log(`window      ${first} .. ${last}`);
console.log(`levels      ${[...levels.entries()].sort().map(([k, v]) => `${k}=${v}`).join("  ")}`);
console.log(`statuses    ${[...statuses.entries()].sort().map(([k, v]) => `${k}=${v}`).join("  ")}`);
console.log(`latency     p50=${percentile(0.5)}ms p95=${percentile(0.95)}ms p99=${percentile(0.99)}ms max=${percentile(1)}ms`);
console.log(`slowest     ${slowest ? `${slowest.requestId} took ${slowest.ms}ms` : "n/a"}`);
console.log(`errors      5xx=${errorCount} (${((errorCount / rows.length) * 100).toFixed(2)}%)`);
