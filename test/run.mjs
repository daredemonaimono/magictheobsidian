// テストの実行。新しい依存は使わず、esbuild で束ねて node で動かす。
//   npm test           ... 手元だけで動くテスト
//   npm run test:online ... Scryfall / MTG Wiki に実際に問い合わせるテスト
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const online = process.argv.includes("--online");
const files = readdirSync("test").filter((f) => f.endsWith(".test.ts") && f.includes(".online.") === online);
const out = mkdtempSync(join(tmpdir(), "mtg-test-"));
let failed = 0;

for (const f of files) {
  const file = join(out, f.replace(/\.ts$/, ".mjs"));
  // obsidian は実行時にしか無いので、テストでは簡易版 (fetch) に差し替える
  await build({ entryPoints: [join("test", f)], bundle: true, platform: "node", format: "esm", outfile: file, alias: { obsidian: "test/obsidian-shim.ts" }, logLevel: "error" });
  const r = spawnSync(process.execPath, [file], { stdio: "inherit" });
  console.log(`${r.status === 0 ? "PASS" : "FAIL"} ${f}`);
  if (r.status !== 0) failed++;
}
rmSync(out, { recursive: true, force: true });
console.log(`${files.length - failed}/${files.length} passed`);
process.exit(failed ? 1 : 0);
