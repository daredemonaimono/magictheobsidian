// カードタイプのアイコン (Mana フォント by Andrew Gioia。SIL OFL 1.1) の SVG を取ってきて、src/typeIconSvgs.ts (テキスト) に書き出す。実行: node scripts/gen-type-icons.mjs
// 色は currentColor にして、画面の文字色に合わせる。表示で通信しない
import { writeFileSync } from "node:fs";
const NAMES = ["planeswalker", "creature", "sorcery", "instant", "artifact", "enchantment", "land", "token"];
const out = {};
for (const n of NAMES) {
  const svg = await (await fetch(`https://raw.githubusercontent.com/andrewgioia/mana/master/svg/${n}.svg`)).text();
  out[n] = svg
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<title>[\s\S]*?<\/title>/g, "")
    .replace(/\s(width|height)="[^"]*"/g, "")
    .replace(/fill="#[0-9a-fA-F]{3,6}"/g, 'fill="currentColor"')
    .replace(/\s+/g, " ")
    .replace(/> </g, "><")
    .trim();
}
const body = Object.keys(out).map((k) => `  ${k}: ${JSON.stringify(out[k])},`).join("\n");
writeFileSync(new URL("../src/typeIconSvgs.ts", import.meta.url), `// 自動生成 (scripts/gen-type-icons.mjs)。カードタイプのアイコン: Mana フォント (https://github.com/andrewgioia/mana) by Andrew Gioia、SIL OFL 1.1\nexport const TYPE_SVGS: Record<string, string> = {\n${body}\n};\n`);
console.log(Object.keys(out).length, "icons");
