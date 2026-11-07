import assert from "node:assert";
import { mergePrintings } from "../src/cards";

// obsidian を読み込む cards.ts は、テストの環境で読み込めるか: mergePrintings は純粋
const p = { id: "3462a3d0-5552-49fa-9eb7-100960c55891", set: "eld", collector_number: "197", rarity: "mythic", released_at: "2019-10-04", lang: "en" };
const note = `---\nname: Oko\nscryfall_id: ${p.id}\n---\n\ntext\n\n[Scryfall](x)\n`;
// フロントマターに同じ id があっても、表が無ければ表ごと足す
const out = mergePrintings(note, [p]);
assert.ok(out.includes("## Printings") && out.includes(`| eld | 197 | mythic | 2019-10-04 | ${p.id} | en |`));
// もう一度足しても、増えない
assert.equal(mergePrintings(out, [p]), out);
// 表があれば、最後の行の下に足す
const q = { ...p, id: "11111111-1111-1111-1111-111111111111", lang: "ja" };
const out2 = mergePrintings(out, [q]);
assert.ok(out2.indexOf(q.id) > out2.indexOf(p.id, out2.indexOf("## Printings")));
console.log("printings-merge ok");
