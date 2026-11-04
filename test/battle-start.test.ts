import assert from "node:assert";
import { CardData, DeckChoice, DeckData, MatchError, buildMatch, opponentChoices, toGameCard, unruledCards } from "../src/battle/deckToGame";
import { boardModel } from "../src/battle/boardModel";
import { Ability, CardRule } from "../src/battle/node";
import { RuleBook } from "../src/battle/state";

const data = (extra: Partial<CardData> = {}): CardData => ({ name: "Test", typeLine: "Creature — Bear", cmc: 2, manaCost: "{1}{G}", colors: ["G"], ...extra });

// ---- Task 2: toGameCard
// 両面・冒険は、前面の型行 (Instant // Land の MDFC や、冒険クリーチャーが、誤って判定されない)
assert.equal(toGameCard(data({ typeLine: "Creature — Human Knight // Sorcery — Adventure" }), "id", "you").typeLine, "Creature — Human Knight");
assert.equal(toGameCard(data({ typeLine: "Instant // Land" }), "id", "you").typeLine, "Instant");
assert.equal(toGameCard(data({ typeLine: "Legendary Planeswalker — Jace" }), "id", "you").typeLine, "Legendary Planeswalker — Jace");
// 両面・冒険・準備は、前面のコスト (Review Focus 3)
assert.equal(toGameCard(data({ manaCost: "{3}{U}{U} // {U}" }), "id", "you").manaCost, "{3}{U}{U}");
assert.equal(toGameCard(data({ manaCost: "" }), "id", "you").manaCost, undefined, "土地など、コストが無いもの");
assert.equal(toGameCard(data({ manaCost: "{X}{R}" }), "id", "you").manaCost, "{X}{R}");
// パワー: * は 0 (Review Focus 4)
{
  const c = toGameCard(data({ power: "*", toughness: "2" }), "id", "you");
  assert.deepEqual([c.power, c.toughness], [0, 2]);
  const d = toGameCard(data({ power: "3", toughness: "4" }), "id", "you");
  assert.deepEqual([d.power, d.toughness], [3, 4]);
  const e = toGameCard(data({}), "id", "you");
  assert.deepEqual([e.power, e.toughness], [undefined, undefined]);
  const f = toGameCard(data({ power: "1+*", toughness: "1+*" }), "id", "you");
  assert.deepEqual([f.power, f.toughness], [0, 0], "数でないものは 0");
}
{
  const c = toGameCard(data({ name: "Jace", typeLine: "Legendary Planeswalker — Jace", loyalty: 4, keywords: ["Flash"], colors: ["U"], cmc: 4 }), "you:Jace#1", "you");
  assert.deepEqual([c.id, c.name, c.owner, c.typeLine, c.mv, c.loyalty, c.keywords, c.colors], ["you:Jace#1", "Jace", "you", "Legendary Planeswalker — Jace", 4, 4, ["Flash"], ["U"]]);
}

// ---- Task 3: buildMatch / unruledCards
const rule = (card: string, ...abilities: Ability[]): CardRule => ({ card, abilities });
const rulesOf = (rs: CardRule[]): RuleBook => ({ get: (c) => rs.find((r) => r.card === c) });
const entry = (key: string, n: number, extra: Partial<CardData> = {}) => ({ key, n, data: data({ name: key, ...extra }) });
const sixty = (format = "standard"): DeckData => ({ format, main: [entry("Island", 24, { typeLine: "Basic Land — Island", cmc: 0, manaCost: "" }), entry("Bear", 4), entry("Wizard", 4), entry("Elf", 4), entry("Bolt", 4, { typeLine: "Instant" }), entry("Cat", 4), entry("Owl", 4), entry("Fox", 4), entry("Ram", 4), entry("Yak", 4)] });
const none = rulesOf([]);

{
  const g = buildMatch(sixty(), sixty(), none, () => 0.5);
  assert.deepEqual(g.players, ["you", "opp"]);
  assert.equal(g.active, "you");
  assert.deepEqual([g.hands["you"].length, g.libraries["you"].length, g.hands["opp"].length, g.libraries["opp"].length], [7, 53, 7, 53]);
  assert.deepEqual([g.strictTurns, g.payManaCosts, g.skipUnruled], [true, true, true]);
  assert.deepEqual(g.life, { you: 20, opp: 20 });
  // 同じカード複数枚でも、id が重ならない (Review Focus 2)
  const ids = [...g.hands["you"], ...g.libraries["you"]].map((c) => c.id);
  assert.equal(new Set(ids).size, 60);
  assert.ok(ids.every((i) => i.startsWith("you:")));
  assert.ok([...g.hands["opp"], ...g.libraries["opp"]].every((c) => c.id.startsWith("opp:") && c.owner === "opp"));
  // 山札の中身は、デッキのとおり
  assert.equal([...g.hands["you"], ...g.libraries["you"]].filter((c) => c.name === "Island").length, 24);
}
{
  // 乱数: 同じなら同じ手札、違えば違う並び
  const seq = (seed: number) => {
    let s = seed;
    return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  };
  const a = buildMatch(sixty(), sixty(), none, seq(1));
  const b = buildMatch(sixty(), sixty(), none, seq(1));
  const c = buildMatch(sixty(), sixty(), none, seq(2));
  assert.deepEqual(a.hands["you"].map((x) => x.id), b.hands["you"].map((x) => x.id));
  assert.notDeepEqual([...a.hands["you"], ...a.libraries["you"]].map((x) => x.id), [...c.hands["you"], ...c.libraries["you"]].map((x) => x.id));
}
// 統率戦は不可。7 枚に足りないデッキは、始める前に止める (Review Focus 1)
assert.throws(() => buildMatch(sixty("commander"), sixty(), none), (e) => e instanceof MatchError && e.message.includes("統率戦"));
assert.throws(() => buildMatch(sixty(), sixty("commander"), none), MatchError);
{
  const small: DeckData = { format: "standard", main: [entry("Island", 6)] };
  assert.throws(() => buildMatch(small, sixty(), none), (e) => e instanceof MatchError && e.message.includes("自分") && e.message.includes("7"));
  assert.throws(() => buildMatch(sixty(), small, none), (e) => e instanceof MatchError && e.message.includes("相手"));
  const seven: DeckData = { format: "standard", main: [entry("Island", 7)] };
  const g = buildMatch(seven, sixty(), none);
  assert.deepEqual([g.hands["you"].length, g.libraries["you"].length], [7, 0], "ちょうど 7 枚なら、始められる");
}
// ルールが設定されていないカード (Review Focus 5)
{
  const rules = rulesOf([rule("Island", { kind: "activated", body: [{ node: "cost", args: { tap: true } }, { node: "addMana", args: { amount: 1, color: "U" } }] }), rule("Bear")]);
  assert.deepEqual(unruledCards([sixty(), sixty()], rules).slice(0, 3), ["Bear", "Wizard", "Elf"], "ルールが無いもの・ノードが空のもの。重複なし、デッキの順 (Island は、ルールがあるので出ない)");
  assert.equal(unruledCards([sixty()], rules).includes("Island"), false);
  assert.equal(new Set(unruledCards([sixty(), sixty()], rules)).size, unruledCards([sixty(), sixty()], rules).length);
}

// ---- 相手のデッキの候補: 自分のフォーマットで使えるもの。統率戦は除く。自分のフォーマットが決まっていなければ、統率戦以外の全部
{
  const d = (name: string, format: string, legal: DeckChoice["legal"] = {}): DeckChoice => ({ name, format, commander: format === "commander", legal });
  const mine = d("Mine", "modern", { modern: "ok" });
  const all = [mine, d("A", "modern", { modern: "ok", legacy: "ok" }), d("B", "standard", { modern: "ng" }), d("C", "legacy", { modern: "unknown" }), d("Cmd", "commander", { modern: "ok" })];
  assert.deepEqual(opponentChoices(mine, all).map((x) => x.name), ["Mine", "A"], "自分のフォーマット (modern) で使える (ok) ものだけ。自分のデッキ自身も候補");
  const free = d("Free", "", {});
  assert.deepEqual(opponentChoices(free, all).map((x) => x.name), ["Mine", "A", "B", "C"], "フォーマットが決まっていなければ、統率戦以外の全部");
  assert.deepEqual(opponentChoices(undefined, all).map((x) => x.name), ["Mine", "A", "B", "C"]);
  assert.deepEqual(opponentChoices(d("Cmd2", "commander"), all), [], "自分が統率戦なら、候補なし (始められない)");
}

// ---- 組み立てた局面を、画面に出す内容に変換できる (手札 7 枚・相手の手札は枚数だけ・ターン 1 のアップキープ)
{
  const g = buildMatch(sixty(), sixty(), none, () => 0.3);
  const m = boardModel(g, none, "you", () => undefined);
  assert.deepEqual([m.self.hand.length, m.self.library, m.opp.handCount, m.opp.hand.length, m.opp.library], [7, 53, 7, 0, 53]);
  assert.deepEqual([m.phase, m.step, m.turn, m.activeSide, m.self.life, m.opp.life], ["beginning", "アップキープ", 1, "self", 20, 20]);
  assert.ok(m.self.hand.every((c) => c.name.length > 0));
}
console.log("start ok");
