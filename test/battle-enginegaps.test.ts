import assert from "node:assert";
import { castProblem } from "../src/battle/engine/restrict";
import { enterBattlefield } from "../src/battle/engine/battlefield";
import { flushEvents } from "../src/battle/engine/triggers";
import { advanceStep } from "../src/battle/engine/turn";
import { passPriority } from "../src/battle/engine";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { checkCall, resetRegistry } from "../src/battle/registry";
import { Game, GameCard, Perm, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

const call = (node: string, args: NodeCall["args"] = {}): NodeCall => ({ node, args });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const card = (id: string, name: string, typeLine: string, owner: string, extra: Partial<GameCard> = {}): GameCard => ({ id, name, typeLine, mv: 1, owner, ...extra });
const perm = (id: string, name: string, controller: string, typeLine = "Artifact"): Perm => ({ id, card: card(id, name, typeLine, controller), controller, enteredTurn: 0 });

// ---- Grafdigger's Cage: 墓地・ライブラリーから、呪文を唱えられない (cantCast from=)。手札からは、唱えられる
{
  const book = rulesOf({ Cage: [{ kind: "static", body: [call("cantCast", { from: "graveyard|library" })] }] });
  assert.equal(checkCall(call("cantCast", { from: "graveyard|library" })), null, "from は、書ける");
  const g = createGame(["A", "B"]);
  g.battlefield.push(perm("Cage", "Cage", "B"));
  const spell = card("Bolt", "Bolt", "Instant", "A");
  assert.equal(castProblem(g, book, "A", spell), null, "手札から (既定) は、唱えられる");
  assert.equal(castProblem(g, book, "A", spell, "hand"), null);
  assert.match(castProblem(g, book, "A", spell, "graveyard") ?? "", /唱えられない/, "墓地からは、唱えられない");
  assert.match(castProblem(g, book, "A", spell, "library") ?? "", /唱えられない/);
  assert.equal(castProblem(g, book, "A", spell, "exile"), null, "追放領域は、対象外");
}

// ---- 「墓地から唱えた」(Prized Amalgam): when event=enters castFrom=graveyard。唱えたゾーンは、perm.cast.from に残る
{
  assert.equal(checkCall(call("when", { event: "enters", castFrom: "graveyard", who: "you", type: "creature" })), null);
  const watcher: Ability = { kind: "triggered", body: [call("when", { event: "enters", castFrom: "graveyard", who: "you", type: "creature" }), call("gainLife", { player: "you", amount: 1 })] };
  const book = rulesOf({ Watcher: [watcher] });
  const g = createGame(["A", "B"]);
  g.battlefield.push(perm("Watcher", "Watcher", "A"));
  enterBattlefield(g, card("c1", "Bear", "Creature — Bear", "A"), "A", book, { from: "graveyard" }); // 墓地から唱えた
  flushEvents(g, book);
  assert.equal(g.stack.length, 1, "墓地から唱えた: 誘発する");
  g.stack.length = 0;
  enterBattlefield(g, card("c2", "Bear", "Creature — Bear", "A"), "A", book, {}); // ふつう
  flushEvents(g, book);
  assert.equal(g.stack.length, 0, "手札から唱えた: 誘発しない");
}

// ---- 誘発の順番 (APNAP): アクティブ・プレイヤーの誘発が先に積まれ (下)、非アクティブ・プレイヤーのものが、あとに積まれる (上。先に解決)。戦場の順に関わらず
{
  const t = (who: string): Ability[] => [{ kind: "triggered", body: [call("when", { event: "step", step: "upkeep" }), call("gainLife", { player: "you", amount: 1 })] }];
  const book = rulesOf({ PA: t("A"), PB: t("B") });
  const g = createGame(["A", "B"]);
  g.active = "A";
  g.battlefield.push(perm("pb", "PB", "B"), perm("pa", "PA", "A")); // 戦場は、B が先
  g.events.push({ type: "step", step: "upkeep", player: "A" });
  flushEvents(g, book);
  assert.deepEqual(g.stack.map((s) => s.controller), ["A", "B"], "下: アクティブ (A)・上: 非アクティブ (B)");
  assert.equal(new Set(g.stack.map((s) => s.id)).size, 2, "id は、重ならない");
}

// ---- クリンナップの再発生: クリンナップ中 (手札を 7 枚にする捨て札) に誘発したら、優先権が回り、解決したあと、もう一度クリンナップ
{
  const trig: Ability = { kind: "triggered", body: [call("when", { event: "moved", from: "hand", to: "graveyard", who: "you" }), call("gainLife", { player: "you", amount: 1 })] };
  const book = rulesOf({ Trig: [trig] });
  const g = createGame(["A", "B"]);
  g.strictTurns = true;
  g.active = "A";
  g.step = "end";
  g.priority = "A";
  g.turn = 3;
  g.battlefield.push(perm("t", "Trig", "A"));
  g.hands["A"] = Array.from({ length: 9 }, (_, i) => card(`H${i}`, "H", "Land", "A"));
  g.libraries["A"] = Array.from({ length: 5 }, (_, i) => card(`L${i}`, "L", "Land", "A"));
  g.libraries["B"] = Array.from({ length: 5 }, (_, i) => card(`M${i}`, "M", "Land", "B"));
  advanceStep(g, book);
  assert.equal(g.step, "end", "クリンナップ中に誘発したので、終了ステップのまま");
  assert.equal(g.turn, 3);
  assert.equal(g.hands["A"].length, 7, "手札は 7 枚");
  assert.equal(g.stack.length, 2, "捨てた 2 枚ぶん、誘発が積まれた");
  assert.equal(g.priority, "A", "アクティブ・プレイヤーに、優先権");
  for (let i = 0; g.stack.length && i < 10; i++) passPriority(g, g.priority!, book);
  assert.equal(g.life["A"], 22, "誘発が解決した");
  assert.equal(g.step, "end", "まだ、終了ステップ (もう一度、クリンナップ)");
  passPriority(g, g.priority!, book);
  passPriority(g, g.priority!, book);
  assert.equal(g.turn, 4, "誘発が無ければ、次のターンへ");
  assert.equal(g.active, "B");
}
{
  // 誘発が無ければ、いままでどおり、すぐに次のターン
  const g = createGame(["A", "B"]);
  g.strictTurns = true;
  g.active = "A";
  g.step = "end";
  g.priority = "A";
  g.turn = 3;
  g.libraries["B"] = Array.from({ length: 5 }, (_, i) => card(`M${i}`, "M", "Land", "B"));
  advanceStep(g, rulesOf({}));
  assert.equal(g.turn, 4);
}
console.log("battle-enginegaps ok");
