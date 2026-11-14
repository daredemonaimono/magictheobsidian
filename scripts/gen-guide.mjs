// AI への手引き (docs/ai-guide.md) の、定義から作る部分を、更新する。定義 (動作・条件・種類など) や、src/ai/examples.ts を足したら、実行する。
//   npm run guide
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(tmpdir(), "mtg-guide-"));
const file = join(out, "guide.mjs");
await build({ entryPoints: ["src/ai/guide.ts"], bundle: true, platform: "node", format: "esm", outfile: file, alias: { obsidian: "test/obsidian-shim.ts" }, loader: { ".md": "text" }, logLevel: "error" });
const { renderGuide } = await import(pathToFileURL(file).href);
rmSync(out, { recursive: true, force: true });
const path = "docs/ai-guide.md";
const before = readFileSync(path, "utf8");
const after = renderGuide(before);
if (after !== before) writeFileSync(path, after);
console.log(after === before ? "手引きは、最新" : "手引きを更新した: " + path);
