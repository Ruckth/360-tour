import { execFileSync, spawnSync } from "node:child_process";

const [shard, total] = process.argv.slice(2, 4).map(Number);
if (!Number.isSafeInteger(shard) || !Number.isSafeInteger(total) || shard < 1 || shard > total) {
  throw new Error("Usage: node .github/scripts/booking-shard.mjs <shard> <total>");
}

const command = ["run", "test:booking-ui"];
function discover(filters = []) {
  const json = execFileSync("bun", [...command, "--list", "--reporter=json", ...filters], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const report = JSON.parse(json);
  function specs(suite) {
    return [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(specs)];
  }
  return report.suites.flatMap(specs);
}

// A source line can declare multiple parameterized cases. Keep them together
// because Playwright's public file:line selector runs all of them.
const groups = new Map();
for (const spec of discover()) {
  const file = spec.file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const location = `/${file}$:${spec.line}`;
  if (!groups.has(location)) groups.set(location, []);
  groups.get(location).push(spec.id);
}

// Place large parameterized groups first, then fill the least-loaded shard.
// Equal-sized groups retain discovery order, spreading adjacent cases in a file.
const shards = Array.from({ length: total }, () => ({ filters: [], ids: [] }));
for (const [location, ids] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
  const target = shards.reduce((a, b) => a.ids.length <= b.ids.length ? a : b);
  target.filters.push(location);
  target.ids.push(...ids);
}

const { filters, ids } = shards[shard - 1];
if (!ids.length) throw new Error(`Component shard ${shard} is empty`);
const selected = discover(filters).map(spec => spec.id).sort();
if (JSON.stringify(selected) !== JSON.stringify(ids.sort())) {
  throw new Error(`Playwright's selected cases do not match the plan for shard ${shard}`);
}
console.error(`Component shard ${shard}/${total}: ${ids.length} tests`);
const result = spawnSync("bun", [...command, ...filters, ...process.argv.slice(4)], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
