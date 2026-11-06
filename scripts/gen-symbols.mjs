// Scryfall のマナシンボル (SVG) を、すべて取ってきて、src/symbolSvgs.ts (テキスト) に書き出す。実行: node scripts/gen-symbols.mjs
// 新しいシンボルが増えたときだけ、もう一度実行する (対戦・一覧の表示は、この文字列を使い、通信しない)
import { writeFileSync } from "node:fs";
const H = { "User-Agent": "magictheobsidian-dev/1.0", Accept: "application/json" };
const list = (await (await fetch("https://api.scryfall.com/symbology", { headers: H })).json()).data;
const out = {};
// マナコストに出る記号 (数字・色・混成・ファイレクシア・X など) と、タップ・氷雪・エネルギー。混沌・ウォッチャー・巨大な数・半分・∞ などは、使わないので入れない
const SKIP = new Set(["CHAOS", "PW", "TK", "A", "D", "L", "100", "1000000"]);
for (const s of list.filter((x) => /^\{[0-9A-Z/]+\}$/.test(x.symbol) && !SKIP.has(x.symbol.slice(1, -1)))) {
  const code = s.symbol.slice(1, -1).replace("/", ""); // {W/U} → WU (symbolImg と同じ)
  const svg = await (await fetch(s.svg_uri, { headers: { "User-Agent": H["User-Agent"] } })).text();
  out[code] = svg.replace(/\s+/g, " ").replace(/> </g, "><").trim();
  await new Promise((r) => setTimeout(r, 120)); // Scryfall への配慮
}
const body = Object.keys(out).sort().map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(out[k])},`).join("\n");
writeFileSync(new URL("../src/symbolSvgs.ts", import.meta.url), `// 自動生成 (scripts/gen-symbols.mjs)。マナシンボルの SVG。表示で通信しないため、プラグインに埋め込む\nexport const SYMBOL_SVGS: Record<string, string> = {\n${body}\n};\n`);
console.log(Object.keys(out).length, "symbols");
