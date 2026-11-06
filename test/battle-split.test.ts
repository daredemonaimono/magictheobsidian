import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { effectsOf, splitAbility, splitClauses, splitOracle } from "../src/battle/splitText";

// ---- 例: Ancestral Recall → 動作 draw / 数字 3 / 対象 player
{
  const [a] = splitOracle("Instant\n\nTarget player draws three cards.");
  assert.equal(a.kind, "spell");
  assert.equal(a.clauses.length, 1);
  assert.deepEqual(a.clauses[0].effects, ["draw"]);
  assert.deepEqual(a.clauses[0].numbers, [3]);
  assert.deepEqual(a.clauses[0].targets, ["player"]);
  assert.deepEqual(a.clauses[0].players, ["target"]);
}
// 節の切り方: 文・then・括弧の注釈
assert.deepEqual(splitClauses("Draw three cards, then put two cards from your hand on top of your library in any order. (Reminder text.)"), ["Draw three cards", "put two cards from your hand on top of your library in any order"]);
assert.deepEqual(splitClauses("Counter target spell unless its controller pays {1}."), ["Counter target spell unless its controller pays {1}"]);
// 能力の種類
assert.equal(splitAbility("Flash").kind, "keyword");
assert.deepEqual(splitAbility("Flying, reach").keywords, ["flying", "reach"]);
assert.equal(splitAbility("{T}: Add {G}.").kind, "activated");
assert.equal(splitAbility("{T}: Add {G}.").cost, "{T}");
assert.deepEqual(splitAbility("{T}: Add {G}.").clauses[0].effects, ["addMana"]);
assert.equal(splitAbility("+2: Create a Food token.").kind, "activated");
assert.deepEqual(splitAbility("+2: Create a Food token.").clauses[0].effects, ["createToken"]);
const trig = splitAbility("When this creature enters, up to one target player puts all the cards from their graveyard on the bottom of their library in a random order.");
assert.equal(trig.kind, "triggered");
assert.equal(trig.condition, "When this creature enters");
assert.ok(trig.clauses[0].effects.includes("move"));
assert.equal(splitAbility("Each player can't cast more than one spell each turn.").kind, "static");
// 数字: 単語・a/an・X
assert.deepEqual(splitAbility("Target creature deals X damage to any target.").clauses[0].numbers, ["X"]);
assert.deepEqual(splitAbility("You gain 3 life.").clauses[0].effects, ["gainLife"]);
assert.deepEqual(splitAbility("Draw a card.").clauses[0].numbers, [1]);

// ---- 当たり率の測定: Cards の効果テキスト (英語) → 辞書が出した動作の候補 と、Rules のノートに実際に書かれた動作のノートを比べる。
// 動作のノートだけを数える (cost・target・when・keyword などの、骨組みのノードは、除く)
const VAULT = "/Users/daredemonai/Documents/Westeros/MagicTheObsidian";
const STRUCTURAL = new Set("cost target when timing keyword affect self additionalCost altCost modes delve storm eventPerm compare statOf controllerOf spentColors select filter countCards emblem entersPrepared prepareSpell prepare zoneCards drawnCards castLimit cantCast cantActivate entersTapped cantEnter upkeepTax reduceCost untapDuring ward staticModify staticGrant loseAbilities setBaseStats setTypes setColors setName extraTriggers createEmblem".split(" "));
const oracleOf = (name: string): string | undefined => {
  try {
    const c = readFileSync(`${VAULT}/Cards/${name}.md`, "utf-8");
    return c.replace(/^---[\s\S]*?\n---\n/, "").replace(/!\[[^\]]*\]\(.*?\)\n*/g, "").split(/\n## Text \(|\n\[Scryfall\]|\n## Printings/)[0].trim();
  } catch {
    return undefined;
  }
};
const actualEffects = (name: string): string[] => {
  const md = readFileSync(`${VAULT}/Rules/${name}.md`, "utf-8").split("\n## 未対応")[0];
  return [...new Set(md.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).split(/\s+/)[0]).filter((n) => !STRUCTURAL.has(n)))];
};
let cards = 0;
let withEffects = 0;
let full = 0; // 実際の動作のノートが、すべて候補に入っているカード
let hit = 0;
let want = 0;
let extra = 0;
const misses: string[] = [];
for (const f of readdirSync(`${VAULT}/Rules`).filter((x) => x.endsWith(".md") && !x.startsWith("_"))) {
  const name = f.replace(/\.md$/, "");
  const oracle = oracleOf(name);
  if (!oracle) continue;
  const actual = actualEffects(name);
  if (!actual.length) continue; // 動作のノートが無い (キーワード・マナ能力だけなど) カードは、測らない
  cards++;
  const cand = effectsOf(splitOracle(oracle));
  withEffects += cand.length ? 1 : 0;
  const got = actual.filter((n) => cand.includes(n));
  hit += got.length;
  want += actual.length;
  extra += cand.filter((n) => !actual.includes(n)).length;
  if (got.length === actual.length) full++;
  else misses.push(`${name}: 実際 [${actual.join(",")}] / 候補 [${cand.join(",")}]`);
}
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
console.log(`split: カード ${cards} 枚 / 動作のノートの再現率 ${pct(hit, want)}% (${hit}/${want}) / すべて拾えたカード ${full} 枚 (${pct(full, cards)}%) / 余計な候補 ${extra} 個`);
if (process.env.SPLIT_MISSES) console.log(misses.join("\n"));
assert.ok(cards >= 20, "測れるカードが、あまりに少ない");
assert.ok(pct(hit, want) >= 85, `動作のノートの再現率が下がった: ${pct(hit, want)}% (辞書を変えたら、測り直す)`);
console.log("split ok");

// ---- 正解が無いカード (Rules が無いもの) では、辞書に合わなかった節の割合を見る (辞書は、上の 51 枚を見て直したので、これが、見ていないカードへの当たり具合の目安)
{
  const have = new Set(readdirSync(`${VAULT}/Rules`).map((f) => f.replace(/\.md$/, "")));
  let clauses = 0;
  let unmatched = 0;
  const lines: string[] = [];
  for (const f of readdirSync(`${VAULT}/Cards`).filter((x) => x.endsWith(".md"))) {
    const name = f.replace(/\.md$/, "");
    if (have.has(name)) continue;
    const o = oracleOf(name);
    if (!o) continue;
    for (const a of splitOracle(o)) {
      if (a.kind === "keyword") continue;
      for (const c of a.clauses) {
        clauses++;
        if (!c.effects.length) {
          unmatched++;
          lines.push(`${name}: ${c.text.slice(0, 90)}`);
        }
      }
    }
  }
  console.log(`split (正解なし): 節 ${clauses} 個のうち、辞書に合わなかった節 ${unmatched} 個 (${pct(unmatched, clauses)}%)`);
  if (process.env.SPLIT_MISSES) console.log(lines.join("\n"));
}
