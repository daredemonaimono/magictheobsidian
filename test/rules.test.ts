import assert from "node:assert";
import { emptyDeck } from "../src/deck";
import { FORMATS, copyLimit, formatOf, judge } from "../src/rules";

const mk = (o: { main?: Record<string, number>; side?: Record<string, number>; commander?: Record<string, number> }) => {
  const d = emptyDeck();
  for (const b of ["main", "side", "commander"] as const) for (const [k, n] of Object.entries(o[b] ?? {})) d[b].set(k, { n });
  return d;
};
const bolt = { key: "Bolt", typeLine: "Instant", text: "" };

// 枚数の上限 (基本土地・例外カード)
assert.equal(copyLimit("Basic Land — Mountain", ""), Infinity);
assert.equal(copyLimit("Basic Snow Land — Mountain", ""), Infinity);
assert.equal(copyLimit("Land", "{T}: Add {C}."), 4);
assert.equal(copyLimit("Creature — Rat", "A deck can have any number of cards named Relentless Rats."), Infinity);
assert.equal(copyLimit("Creature — Dwarf", "A deck can have up to seven cards named Seven Dwarves."), 7);

// format が無い・知らないデッキは「制限なし」(枚数だけ見る)
const free = formatOf(undefined);
assert.equal(free, FORMATS.constructed);
assert.ok(free.canAdd({ deck: mk({ main: { Bolt: 4 } }), board: "main", ...bolt }));
assert.equal(free.canAdd({ deck: mk({}), board: "main", ...bolt, legal: [] }), null, "使用可否は見ない");

// 60枚のフォーマット: 禁止は追加不可、legal 未取得は通す、4枚はメインとサイドの合計、サイドは15枚
const modern = formatOf("modern");
assert.ok(modern.canAdd({ deck: mk({}), board: "main", ...bolt, legal: ["legacy"] })?.includes("Modern"));
assert.equal(modern.canAdd({ deck: mk({}), board: "main", ...bolt, legal: ["modern"] }), null);
assert.equal(modern.canAdd({ deck: mk({}), board: "main", ...bolt }), null);
assert.ok(modern.canAdd({ deck: mk({ main: { Bolt: 2 }, side: { Bolt: 2 } }), board: "side", ...bolt, legal: ["modern"] }));
assert.equal(modern.canAdd({ deck: mk({ side: { A: 14 } }), board: "side", ...bolt, legal: ["modern"] }), null);
assert.ok(modern.canAdd({ deck: mk({ side: { A: 15 } }), board: "side", ...bolt, legal: ["modern"] }));
assert.equal(modern.canAdd({ deck: mk({ main: { Mountain: 30 } }), board: "main", key: "Mountain", typeLine: "Basic Land — Mountain", text: "", legal: ["modern"] }), null);

// Vintage: 制限カードはメインとサイドの合計で1枚
const vintage = formatOf("vintage");
const lotus = { key: "Lotus", typeLine: "Artifact", text: "", legal: ["vintage"], restricted: ["vintage"] };
assert.equal(vintage.canAdd({ deck: mk({}), board: "main", ...lotus }), null);
assert.ok(vintage.canAdd({ deck: mk({ main: { Lotus: 1 } }), board: "main", ...lotus }));
assert.ok(vintage.canAdd({ deck: mk({ side: { Lotus: 1 } }), board: "main", ...lotus }));
assert.equal(vintage.canAdd({ deck: mk({ main: { Bolt: 3 } }), board: "main", ...bolt, legal: ["vintage"] }), null);

// 統率戦: コマンダー1体 (伝説のクリーチャーか、コマンダーにできると書かれたカード)、同名1種、合計100枚
const cmd = formatOf("commander");
assert.deepEqual(cmd.boards, ["main"]);
assert.equal(cmd.hasCommander, true);
const legend = { key: "Atraxa", typeLine: "Legendary Creature — Phyrexian Angel", text: "", legal: ["commander"] };
assert.equal(cmd.canAdd({ deck: mk({}), board: "commander", ...legend }), null);
assert.ok(cmd.canAdd({ deck: mk({}), board: "commander", ...bolt, legal: ["commander"] })?.includes("コマンダーにできない"));
assert.ok(cmd.canAdd({ deck: mk({ commander: { Atraxa: 1 } }), board: "commander", key: "Other", typeLine: "Legendary Creature", text: "", legal: ["commander"] })?.includes("1体"));
assert.equal(cmd.canAdd({ deck: mk({}), board: "commander", key: "Cmdr", typeLine: "Legendary Planeswalker", text: "Cmdr can be your commander.", legal: ["commander"] }), null);
assert.ok(cmd.canAdd({ deck: mk({ main: { Bolt: 1 } }), board: "main", ...bolt, legal: ["commander"] })?.includes("1枚まで"));
assert.equal(cmd.canAdd({ deck: mk({ main: { Mountain: 30 } }), board: "main", key: "Mountain", typeLine: "Basic Land — Mountain", text: "", legal: ["commander"] }), null);
assert.ok(cmd.canAdd({ deck: mk({ commander: { Atraxa: 1 }, main: { Mountain: 99 } }), board: "main", key: "Mountain", typeLine: "Basic Land — Mountain", text: "", legal: ["commander"] })?.includes("100枚"));

// フォーマットの判定 (○ × ?)
const cards = [{ key: "A", legal: ["modern", "legacy"] }, { key: "B", legal: ["legacy"] }];
assert.equal(judge(cards, "legacy"), "ok");
assert.equal(judge(cards, "modern"), "ng");
assert.equal(judge([cards[0], { key: "U" }], "modern"), "unknown", "未取得が混ざると判定できない");
assert.equal(judge([cards[1], { key: "U" }], "modern"), "ng", "使えないと分かっていれば、未取得があっても ng");
assert.equal(judge([], "modern"), "unknown");
assert.equal(judge([{ key: "A", legal: ["standard", "commander"] }], "standard", true), "ng", "コマンダーのデッキは Commander 以外 ng");
assert.equal(judge([{ key: "A", legal: ["standard", "commander"] }], "commander", true), "ok");
