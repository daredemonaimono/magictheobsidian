import assert from "node:assert";
import { boardModel, sideView } from "../src/battle/boardModel";
import { sampleBattle } from "../src/battle/sampleBattle";
import { CARD_BACK_ID, CARD_H, CARD_W, GAP, TAP_EXTRA, cardBackUrl, overlapFor, pileLayers, rowNeed } from "../src/battle/layout";
import { Game, GameCard, Perm, RuleBook, createGame } from "../src/battle/state";

const noRules: RuleBook = { get: () => undefined };
const card = (id: string, typeLine: string, owner = "A", extra: Partial<GameCard> = {}): GameCard => ({ id, name: id, typeLine, mv: 1, owner, ...extra });
const perm = (id: string, typeLine: string, owner = "A", extra: Partial<Perm> = {}, cardExtra: Partial<GameCard> = {}): Perm => ({ id, card: card(id, typeLine, owner, cardExtra), controller: owner, ...extra });
const none = () => undefined;

// ---- Task 1: ゾーンと両陣営の表示内容

// 空の局面: 全ゾーンが空、ライフ 20 (Review Focus 1)
{
  const g = createGame(["A", "B"]);
  const s = sideView(g, noRules, "A", none, true);
  assert.deepEqual([s.hand, s.lands, s.creatures, s.others], [[], [], [], []]);
  assert.deepEqual([s.life, s.handCount, s.library, s.graveyard, s.exile], [20, 0, 0, 0, 0]);
  assert.equal(s.player, "A");
}

// 枚数
{
  const g = createGame(["A", "B"]);
  g.hands["A"].push(card("h1", "Instant"), card("h2", "Instant"));
  g.libraries["A"] = [card("l1", "Land"), card("l2", "Land"), card("l3", "Land")];
  g.graveyards["A"].push(card("g1", "Instant"));
  g.exile["A"].push(card("e1", "Instant"));
  const s = sideView(g, noRules, "A", none, true);
  assert.deepEqual([s.handCount, s.library, s.graveyard, s.exile], [2, 3, 1, 1]);
  assert.deepEqual(s.hand.map((c) => c.id), ["h1", "h2"]);
}

// 列の分け方: クリーチャー(土地クリーチャーも) / 土地 / それ以外。順番は戦場の順。相手のパーマネントは入らない
{
  const g = createGame(["A", "B"]);
  g.battlefield.push(perm("Island", "Basic Land — Island"), perm("Bear", "Creature — Bear"), perm("Relic", "Artifact"), perm("Dryad", "Land Creature — Forest Dryad"), perm("Jace", "Legendary Planeswalker — Jace"), perm("Theirs", "Creature — Goblin", "B"));
  const s = sideView(g, noRules, "A", none, true);
  assert.deepEqual(s.lands.map((c) => c.id), ["Island"]);
  assert.deepEqual(s.creatures.map((c) => c.id), ["Bear", "Dryad"]);
  assert.deepEqual(s.others.map((c) => c.id), ["Relic", "Jace"]);
  assert.deepEqual(sideView(g, noRules, "B", none, false).creatures.map((c) => c.id), ["Theirs"]);
}

// 相手の手札は、枚数だけ
{
  const g = createGame(["A", "B"]);
  for (let i = 0; i < 20; i++) g.hands["B"].push(card(`o${i}`, "Instant", "B"));
  const s = sideView(g, noRules, "B", none, false);
  assert.deepEqual(s.hand, []);
  assert.equal(s.handCount, 20, "手札が 20 枚でも、枚数は数える (Review Focus 2)");
  const mine = createGame(["A", "B"]);
  for (let i = 0; i < 14; i++) mine.hands["A"].push(card(`m${i}`, "Instant"));
  assert.equal(sideView(mine, noRules, "A", none, true).hand.length, 14, "自分の手札は、全部を渡す (扇の収め方は画面の側)");
}

// タップ・ダメージ・カウンター・P/T (+1/+1 カウンターをふまえる)
{
  const g = createGame(["A", "B"]);
  g.battlefield.push(perm("Bear", "Creature — Bear", "A", { tapped: true, damage: 2, counters: { "+1/+1": 1 } }, { power: 2, toughness: 2 }));
  const c = sideView(g, noRules, "A", none, true).creatures[0];
  assert.deepEqual([c.tapped, c.damage, c.counters["+1/+1"]], [true, 2, 1]);
  assert.deepEqual([c.power, c.toughness], [3, 3]);
  assert.deepEqual([c.attacking, c.blocking, c.prepared], [false, false, false]);
}

// 攻撃・ブロック・準備済
{
  const g = createGame(["A", "B"]);
  g.battlefield.push(perm("Atk", "Creature — Bear", "A", { attacking: true, attackTarget: "B" }, { power: 1, toughness: 1 }), perm("Blk", "Creature — Bear", "A", { blocking: "x", prepared: true }, { power: 1, toughness: 1 }));
  const [a, b] = sideView(g, noRules, "A", none, true).creatures;
  assert.deepEqual([a.attacking, a.blocking, a.prepared], [true, false, false]);
  assert.deepEqual([b.attacking, b.blocking, b.prepared], [false, true, true]);
}

// 召喚酔い: このターンに出たクリーチャー。速攻があれば酔わない。クリーチャーでなければ酔わない
{
  const g = createGame(["A", "B"]);
  g.turn = 3;
  g.battlefield.push(
    perm("Fresh", "Creature — Bear", "A", { enteredTurn: 3 }, { power: 1, toughness: 1 }),
    perm("Fast", "Creature — Bear", "A", { enteredTurn: 3 }, { power: 1, toughness: 1, keywords: ["haste"] }),
    perm("Old", "Creature — Bear", "A", { enteredTurn: 2 }, { power: 1, toughness: 1 }),
    perm("Relic", "Artifact", "A", { enteredTurn: 3 }),
  );
  const s = sideView(g, noRules, "A", none, true);
  assert.deepEqual(s.creatures.map((c) => c.sick), [true, false, false]);
  assert.equal(s.others[0].sick, false);
}

// 画像が無い・トークン・忠誠度 (Review Focus 4)
{
  const g = createGame(["A", "B"]);
  g.battlefield.push(
    perm("Tok", "Token Creature — Illusion", "A", {}, { power: 1, toughness: 1, token: true }),
    perm("Jace", "Legendary Planeswalker — Jace", "A", { counters: { loyalty: 4 } }, { loyalty: 4 }),
  );
  const s = sideView(g, noRules, "A", (c) => (c.id === "Jace" ? "https://example.test/jace.jpg" : undefined), true);
  assert.equal(s.creatures[0].token, true);
  assert.equal(s.creatures[0].image, undefined, "画像が無くても落ちない");
  assert.equal(s.others[0].loyalty, 4);
  assert.equal(s.others[0].image, "https://example.test/jace.jpg");
  assert.equal(s.creatures[0].loyalty, undefined);
}

// ---- Task 2: フェイズ・戦闘・スタック・マナ・勝敗・ログ
{
  const table: [Game["step"], Game["combatPhase"], string, string][] = [
    ["untap", undefined, "beginning", "アンタップ"],
    ["upkeep", undefined, "beginning", "アップキープ"],
    ["draw", undefined, "beginning", "ドロー"],
    ["main1", undefined, "main1", "メイン"],
    ["combat", undefined, "combat", "戦闘"],
    ["combat", "beginning", "combat", "戦闘開始"],
    ["combat", "attackers", "combat", "攻撃クリーチャー指定"],
    ["combat", "blockers", "combat", "ブロック指定"],
    ["combat", "firstStrike", "combat", "先制攻撃ダメージ"],
    ["combat", "damage", "combat", "戦闘ダメージ"],
    ["combat", "end", "combat", "戦闘終了"],
    ["main2", undefined, "main2", "メイン"],
    ["end", undefined, "ending", "終了"],
  ];
  for (const [step, cp, phase, label] of table) {
    const g = createGame(["A", "B"]);
    g.step = step;
    g.combatPhase = cp;
    const m = boardModel(g, noRules, "A", none);
    assert.deepEqual([m.phase, m.step, m.combat], [phase, label, step === "combat"], `${step}/${cp}`);
  }
}

// 自分・相手・手番・ターン
{
  const g = createGame(["A", "B"]);
  g.active = "B";
  g.turn = 4;
  g.hands["A"].push(card("h", "Instant"));
  g.hands["B"].push(card("o", "Instant", "B"));
  const m = boardModel(g, noRules, "A", none);
  assert.deepEqual([m.self.player, m.opp.player, m.activeSide, m.turn], ["A", "B", "opp", 4]);
  assert.equal(m.self.hand.length, 1);
  assert.deepEqual([m.opp.hand.length, m.opp.handCount], [0, 1], "相手の手札は、枚数だけ");
  assert.equal(boardModel(g, noRules, "B", none).activeSide, "self");
}

// スタック
{
  const g = createGame(["A", "B"]);
  g.stack.push({ id: "s1", card: card("Bolt", "Instant"), controller: "B", targets: {}, cast: {} }, { id: "s2", card: card("Relic", "Artifact"), controller: "A", targets: {}, cast: {}, ability: true });
  const m = boardModel(g, noRules, "A", none);
  assert.deepEqual(m.stack, [
    { id: "s1", name: "Bolt", controller: "opp", ability: false },
    { id: "s2", name: "Relic", controller: "self", ability: true },
  ]);
}

// マナ・プール: 無色は合計から色つきを引いた残り。負にならない
{
  const g = createGame(["A", "B"]);
  g.mana["A"] = 3;
  g.pool["A"] = { U: 1 };
  assert.deepEqual(boardModel(g, noRules, "A", none).manaSelf, { total: 3, colors: { U: 1 }, colorless: 2 });
  g.mana["A"] = 0;
  assert.equal(boardModel(g, noRules, "A", none).manaSelf.colorless, 0, "pool が合計を超えても、無色は負にならない");
}

// 勝敗: 勝者 / 引き分け / 続行中。ライフは、負でも大きくても、そのまま数値 (Review Focus 5)
{
  const g = createGame(["A", "B"]);
  assert.equal(boardModel(g, noRules, "A", none).over, undefined);
  g.over = { winner: "B" };
  assert.deepEqual(boardModel(g, noRules, "A", none).over, { winner: "opp" });
  assert.deepEqual(boardModel(g, noRules, "B", none).over, { winner: "self" });
  g.over = {};
  assert.deepEqual(boardModel(g, noRules, "A", none).over, {}, "引き分け");
  g.life = { A: -3, B: 9999 };
  const m = boardModel(g, noRules, "A", none);
  assert.deepEqual([m.self.life, m.opp.life], [-3, 9999]);
}

// ログは最後の 50 行。同じ Game から2回作ると、同じ内容 (差分更新の前提)
{
  const g = createGame(["A", "B"]);
  for (let i = 0; i < 60; i++) g.log.push(`line ${i}`);
  const m = boardModel(g, noRules, "A", none);
  assert.equal(m.log.length, 50);
  assert.deepEqual([m.log[0], m.log[49]], ["line 10", "line 59"]);
  assert.deepEqual(boardModel(g, noRules, "A", none), m);
}

// ---- Task 3: サンプルの局面 (本物の Game)
{
  const { game, rules } = sampleBattle();
  const m = boardModel(game, rules, "you", none);
  assert.equal(m.self.hand.length, 6);
  assert.deepEqual([m.self.lands.length, m.self.lands.filter((c) => c.tapped).length], [4, 1]);
  assert.equal(m.self.creatures.length, 4, "トークンを含む");
  assert.equal(m.self.creatures.filter((c) => c.attacking).length, 3);
  assert.ok(m.self.creatures.some((c) => c.token));
  assert.deepEqual(m.self.others.map((c) => c.name), ["Octopus Form", "The Theorist, Jace Beleren"]);
  assert.equal(m.self.others[1].loyalty, 4);
  assert.deepEqual([m.self.library, m.self.graveyard, m.opp.library, m.opp.graveyard], [46, 2, 47, 2]);
  assert.deepEqual([m.opp.handCount, m.opp.hand.length], [5, 0]);
  assert.equal(m.opp.creatures.length, 3);
  assert.equal(m.opp.creatures.filter((c) => c.blocking).length, 1);
  assert.equal(m.opp.creatures.filter((c) => c.damage === 1).length, 1);
  assert.deepEqual([m.phase, m.step, m.combat], ["combat", "ブロック指定", true]);
  assert.deepEqual([m.self.life, m.opp.life], [20, 15]);
  assert.deepEqual(m.manaSelf, { total: 1, colors: { U: 1 }, colorless: 0 });
  assert.equal(m.log.length, 5);
  const geist = m.self.creatures.find((c) => c.name === "Geist of Saint Thalia")!;
  assert.ok(geist.keywords.includes("flying"));
  const adept = m.self.creatures.find((c) => c.name === "Elementalist Adept")!;
  assert.deepEqual([adept.power, adept.toughness], [3, 3], "+1/+1 カウンター");
  // 状況起因処理を通っても、何も変わらない (落ちるものが無い、正しい局面)
  const before = JSON.stringify(boardModel(game, rules, "you", none));
  const g2 = sampleBattle().game;
  assert.equal(JSON.stringify(boardModel(g2, rules, "you", none)), before, "毎回、同じ局面");
  assert.ok(game.life["you"] > 0 && game.life["opp"] > 0);
  assert.equal(game.over, undefined);
}

// ---- 土地の山: 同じ名前の土地を1つの山にまとめる (順番は最初に出た順)。タップした枚数・立っている枚数を数える
{
  const g = createGame(["A", "B"]);
  g.battlefield.push(
    perm("I1", "Basic Land — Island", "A", { tapped: true }, { name: "Island" }),
    perm("F1", "Basic Land — Forest", "A", {}, { name: "Forest" }),
    perm("I2", "Basic Land — Island", "A", {}, { name: "Island" }),
    perm("I3", "Basic Land — Island", "A", { tapped: true }, { name: "Island" }),
    perm("Bear", "Creature — Bear", "A", {}, { power: 1, toughness: 1 }),
  );
  const s = sideView(g, noRules, "A", none, true);
  assert.deepEqual(s.landStacks.map((x) => [x.name, x.cards.length, x.untapped, x.tapped]), [["Island", 3, 1, 2], ["Forest", 1, 1, 0]]);
  assert.deepEqual(s.landStacks[0].cards.map((c) => c.id), ["I1", "I2", "I3"], "山の中は戦場の順");
  assert.deepEqual(s.lands.map((c) => c.id), ["I1", "F1", "I2", "I3"], "lands (平らな一覧) も残る");
  assert.equal(sideView(createGame(["A", "B"]), noRules, "A", none, true).landStacks.length, 0, "土地が無ければ山も無い");
  // 土地クリーチャーは山にしない (クリーチャーの列)
  const g2 = createGame(["A", "B"]);
  g2.battlefield.push(perm("D", "Land Creature — Forest Dryad", "A", {}, { power: 1, toughness: 1 }));
  assert.equal(sideView(g2, noRules, "A", none, true).landStacks.length, 0);
}

// ---- 列の重なり: 幅に収まるように、重ねる量を決める (タップしたカードの横幅の分も数える。Review の重要な指摘)
{
  const need = rowNeed(CARD_W, 30, 30); // 30 枚すべてタップ
  assert.equal(need, 30 * CARD_W + 29 * GAP + 30 * TAP_EXTRA);
  assert.equal(TAP_EXTRA, CARD_H - CARD_W, "横向きのカードが余分に取る幅 = 縦と横の差");
  const ov = overlapFor(need, 30, 846);
  assert.ok(need - ov * 29 <= 846, "重ねたあとの幅が、収まる");
  assert.equal(overlapFor(500, 5, 846), 0, "収まるなら重ねない");
  assert.equal(overlapFor(900, 1, 846), 0, "1枚のときは重ねない");
  assert.equal(overlapFor(900, 5, 0), 0, "幅が測れないとき (0) は重ねない");
}

// ---- 召喚酔いは、エンジンの判定を使う (画面にルールを持たない)
{
  const g = createGame(["A", "B"]);
  g.turn = 2;
  g.battlefield.push(perm("Fresh", "Creature — Bear", "A", { enteredTurn: 2 }, { power: 1, toughness: 1 }));
  assert.equal(sideView(g, noRules, "A", none, true).creatures[0].sick, true);
}

// ---- 山札・墓地の厚み: 枚数が多いほど厚く、上限がある。0 枚なら 0 (空の枠だけ)
{
  assert.equal(pileLayers(0), 0);
  assert.equal(pileLayers(1), 1);
  assert.equal(pileLayers(10), 1, "10 枚までは 1 層");
  assert.equal(pileLayers(11), 2, "10 枚ごとに 1 層");
  assert.equal(pileLayers(46), 5);
  assert.equal(pileLayers(60), 6);
  assert.equal(pileLayers(100), 10);
  assert.equal(pileLayers(250), 12, "上限");
  assert.equal(pileLayers(-3), 0, "負の数でも落ちない");
  let prev = 0;
  for (let n = 0; n <= 120; n++) {
    const v = pileLayers(n);
    assert.ok(v >= prev, "枚数が増えて、薄くならない");
    prev = v;
  }
}

// ---- 墓地の一番上のカード (画像つき)。墓地が空なら無い
{
  const g = createGame(["A", "B"]);
  assert.equal(sideView(g, noRules, "A", none, true).graveyardTop, undefined);
  g.graveyards["A"].push(card("g1", "Instant"), card("g2", "Sorcery"));
  const top = sideView(g, noRules, "A", (c) => (c.id === "g2" ? "https://example.test/g2.jpg" : undefined), true).graveyardTop!;
  assert.deepEqual([top.id, top.image], ["g2", "https://example.test/g2.jpg"], "最後に墓地に置かれたものが、一番上");
}

// ---- カードの裏面 (Scryfall の card_back_id。公式のカードの裏の絵)
{
  assert.equal(CARD_BACK_ID, "0aeebaf5-8c7d-4636-9e82-8c27447861f7");
  assert.equal(cardBackUrl(), "https://backs.scryfall.io/small/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg");
  assert.equal(cardBackUrl("normal"), "https://backs.scryfall.io/normal/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg");
}
// ---- 使えるもの (playable)・「次へ」
{
  const { registerBuiltinNodes } = await import("../src/battle/nodes");
  const { resetRegistry } = await import("../src/battle/registry");
  const { createGame } = await import("../src/battle/state");
  resetRegistry();
  registerBuiltinNodes();
  const book = { get: (c: string) => (c === "Island" ? { card: c, abilities: [{ kind: "activated" as const, body: [{ node: "cost", args: { tap: true } }, { node: "addMana", args: { amount: 1, color: "U" } }] }] } : c === "Bear" ? { card: c, abilities: [] } : undefined) };
  const g = createGame(["A", "B"]);
  g.payManaCosts = true;
  g.step = "main1";
  const isl = { id: "i1", name: "Island", typeLine: "Basic Land — Island", mv: 0, owner: "A" };
  g.battlefield.push({ id: "i1", card: isl, controller: "A" });
  g.hands["A"].push({ id: "b1", name: "Bear", typeLine: "Creature — Bear", mv: 1, manaCost: "{U}", owner: "A" });
  let m = boardModel(g, book, "A", none);
  assert.deepEqual([m.self.lands[0].playable, m.self.hand[0].playable, m.canNext, m.nextLabel], [true, false, true, "次へ"]);
  g.battlefield[0].tapped = true;
  g.mana["A"] = 1;
  g.pool["A"] = { U: 1 };
  m = boardModel(g, book, "A", none);
  assert.deepEqual([m.self.lands[0].playable, m.self.hand[0].playable], [false, true]);
  g.stack.push({ id: "s", card: isl, controller: "A", targets: {}, cast: {} });
  assert.equal(boardModel(g, book, "A", none).nextLabel, "解決する");
  g.over = {};
  assert.equal(boardModel(g, book, "A", none).canNext, false);
  delete g.over;
  g.mulligan = { count: 1 };
  m = boardModel(g, book, "A", none);
  assert.deepEqual([m.canNext, m.mulligan, m.self.hand.every((c) => !c.playable)], [false, { count: 1 }, true], "マリガンの途中は、進めず、何も使えない");
  assert.equal(boardModel(g, book, "B", none).self.hand.every((c) => !c.playable), true);
}
console.log("boardmodel ok");
