import assert from "node:assert";
import { canCastNow, passPriority } from "../src/battle/engine";
import { GameCard, RuleBook, createGame, opponentsOf } from "../src/battle/state";

const none: RuleBook = { get: () => undefined };
const card = (id: string, typeLine: string, owner = "A", o: Partial<GameCard> = {}): GameCard => ({ id, name: id, typeLine, mv: 1, owner, ...o });
const push = (g: ReturnType<typeof createGame>, c: GameCard) => g.stack.push({ id: c.id, card: c, controller: c.owner, targets: {}, cast: {} });

// 作り方: 先頭のプレイヤーが active で、メインフェイズ1の優先権を持つ。相手は自分以外の全員
const g = createGame(["A", "B"]);
assert.equal(g.active, "A");
assert.equal(g.priority, "A");
assert.equal(g.step, "main1");
assert.deepEqual(opponentsOf(g, "A"), ["B"]);
assert.deepEqual(opponentsOf(createGame(["A", "B", "C"]), "B"), ["A", "C"]);

// パスすると優先権が移る。優先権の無い人のパスは throw
assert.throws(() => passPriority(g, "B", none));
assert.equal(passPriority(g, "A", none), "passed");
assert.equal(g.priority, "B");

// 全員が連続でパス (スタックが空) → 次のステップへ、優先権は active に戻る
assert.equal(passPriority(g, "B", none), "stepEnded");
assert.equal(g.step, "combat");
assert.equal(g.priority, "A");

// 全員が連続でパス (スタックあり) → 一番上の1つだけ解決して、優先権は active
const s = createGame(["A", "B"]);
push(s, card("first", "Instant"));
push(s, card("second", "Instant"));
passPriority(s, "A", none);
assert.equal(passPriority(s, "B", none), "resolved");
assert.equal(s.stack.length, 1);
assert.equal(s.stack[0].id, "first");
assert.equal(s.graveyards["A"].length, 1);
assert.equal(s.priority, "A");

// ターンの終わり: 相手が active になり、アップキープから (アンタップは優先権なし)
const e = createGame(["A", "B"]);
e.step = "end";
passPriority(e, "A", none);
passPriority(e, "B", none);
assert.equal(e.active, "B");
assert.equal(e.step, "upkeep");
assert.equal(e.priority, "B");

// 唱えられるタイミングはカードタイプから決まる
const t = createGame(["A", "B"]);
const bolt = card("bolt", "Instant");
const sorcery = card("ritual", "Sorcery");
const flash = card("ambush", "Creature — Merfolk", "B", { flash: true });
assert.ok(canCastNow(t, "A", sorcery), "自分のメイン1・スタック空");
assert.ok(canCastNow(t, "A", bolt));
assert.ok(!canCastNow(t, "B", bolt), "優先権が無い");
passPriority(t, "A", none);
assert.ok(canCastNow(t, "B", bolt), "相手のターンでもインスタントは優先権があれば唱えられる");
assert.ok(canCastNow(t, "B", flash));
assert.ok(!canCastNow(t, "B", sorcery), "ソーサリーは自分のターンだけ");
assert.ok(!canCastNow(t, "B", card("crea", "Creature — Elf", "B")), "フラッシュの無いクリーチャーも同じ");
const busy = createGame(["A", "B"]);
push(busy, bolt);
assert.ok(!canCastNow(busy, "A", sorcery), "スタックが空でなければソーサリーは唱えられない");
const combat = createGame(["A", "B"]);
combat.step = "combat";
assert.ok(!canCastNow(combat, "A", sorcery), "メインフェイズ以外では唱えられない");

// ライブラリー・戦場・マナ (ノードの追加に必要な最小の領域)
const z = createGame(["A", "B"]);
assert.deepEqual(z.libraries, { A: [], B: [] });
assert.deepEqual(z.mana, { A: 0, B: 0 });
assert.deepEqual(z.battlefield, []);
assert.equal(z.decide, undefined);

// アンタップ・ステップ: ターンが替わるとき、次のターンのプレイヤーのパーマネントがアンタップされる (相手のものはそのまま)
{
  const u = createGame(["A", "B"]);
  u.battlefield.push({ id: "a1", card: card("a1", "Creature — Bear", "A"), controller: "A", tapped: true }, { id: "b1", card: card("b1", "Creature — Bear", "B"), controller: "B", tapped: true });
  u.step = "end";
  passPriority(u, "A", none);
  passPriority(u, "B", none);
  assert.equal(u.active, "B");
  assert.equal(u.battlefield.find((p) => p.id === "b1")!.tapped, false, "B のターンの最初に、B のものがアンタップ");
  assert.equal(u.battlefield.find((p) => p.id === "a1")!.tapped, true, "A のものはそのまま");
}
