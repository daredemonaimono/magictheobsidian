import assert from "node:assert";
import { Block, CardDef, Controller, Game, Perm, PriorityAction, makeDef, parseCost, parseKeywords, parseMana, planPayment } from "../src/engine";

const def = (name: string, typeLine: string, manaCost: string, power = 0, toughness = 0, oracle = ""): CardDef =>
  makeDef({ key: name, name, typeLine, manaCost, cmc: (manaCost.match(/\{[^}]+\}/g) ?? []).length, power, toughness, oracle });
const mountain = def("Mountain", "Basic Land — Mountain", "");
const bear = def("Bear", "Creature — Bear", "{1}{R}", 2, 2);

// ---- カードの読み取り ----
assert.deepEqual(parseCost("{2}{W}{W}"), { generic: 2, colored: ["W", "W"] });
assert.deepEqual(parseCost("{W/U}{B/P}"), { generic: 0, colored: ["WU", "B"] });
assert.deepEqual(parseMana("Basic Land — Swamp", ""), ["B"]);
assert.deepEqual(parseMana("Artifact", "{T}: Add {C}{C}."), ["C", "C"]);
assert.deepEqual(parseMana("Land", "({T}: Add {W} or {B}.)\n{T}: Add {W} or {B}."), ["WB"]);
assert.deepEqual(parseMana("Artifact", "{T}, Sacrifice Black Lotus: Add three mana of any one color."), []);
assert.deepEqual(parseKeywords("Flying, haste\nWhen this enters, draw a card. (Flying)"), ["flying", "haste"]);

// ---- マナの支払い ----
const src = (d: CardDef, uid: number): Perm => ({ uid, def: d, owner: 0, controller: 0, tapped: false, sick: false, damage: 0, attacking: false });
const scrubland = def("Scrubland", "Land", "", 0, 0, "{T}: Add {W} or {B}.");
const crypt = def("Mana Crypt", "Artifact", "{0}", 0, 0, "{T}: Add {C}{C}.");
assert.ok(planPayment(parseCost("{2}{B}"), [src(scrubland, 1), src(crypt, 2)]), "Scrubland の B + Mana Crypt の CC");
assert.equal(planPayment(parseCost("{W}{B}"), [src(scrubland, 1), src(crypt, 2)]), null, "白と黒を両方は出せない");
assert.equal(planPayment(parseCost("{R}"), [src(scrubland, 1)]), null);
assert.deepEqual(planPayment(parseCost("{0}"), []), []);

// ---- 1ゲームが最後まで回る ----
const greedy: Controller = async (g, d) => {
  if (d.type === "priority") {
    const land = d.actions.find((a) => a.kind === "land");
    if (land) return land;
    const casts = d.actions.filter((a): a is Extract<PriorityAction, { kind: "cast" }> => a.kind === "cast");
    return casts.at(-1) ?? { kind: "pass" };
  }
  if (d.type === "attackers") return d.eligible;
  return [] as Block[];
};
{
  const deck = [...Array(24).fill(mountain), ...Array(16).fill(bear)];
  const g = new Game([deck, deck], 1, [greedy, greedy]);
  await g.play(80);
  assert.notEqual(g.s.winner, undefined, "決着がつく");
  const lands = g.s.log.filter((l) => l.includes("土地を出す")).length;
  assert.ok(lands <= g.s.turn, "土地は1ターンに1枚まで");
  // 同じ seed なら同じ展開
  const g2 = new Game([deck, deck], 1, [greedy, greedy]);
  await g2.play(80);
  assert.deepEqual(g2.s.log, g.s.log);
}

// ---- 召喚酔いと速攻 ----
const setup = (a: CardDef[], b: CardDef[], handA: CardDef[], handB: CardDef[] = [], fieldB: CardDef[] = []) => {
  const g = new Game([a, b], 7, [greedy, greedy]);
  let uid = 1000;
  const card = (d: CardDef, owner: number) => ({ uid: uid++, def: d, owner });
  g.s.players[0].hand = handA.map((d) => card(d, 0));
  g.s.players[1].hand = handB.map((d) => card(d, 1));
  g.s.players[1].field = fieldB.map((d) => ({ ...card(d, 1), controller: 1, tapped: false, sick: false, damage: 0, attacking: false }));
  return g;
};
const pad = Array(40).fill(mountain);
{
  const cub = def("Cub", "Creature — Bear", "{R}", 2, 2);
  const g = setup(pad, pad, [mountain, cub]);
  await g.play(1);
  assert.equal(g.s.players[1].life, 20, "召喚酔いのクリーチャーは攻撃できない");
  assert.ok(g.s.players[0].field.some((p) => p.def.name === "Cub"));
}
{
  const hasty = def("Hasty", "Creature — Goblin", "{R}", 2, 1, "Haste");
  const g = setup(pad, pad, [mountain, hasty]);
  await g.play(1);
  assert.equal(g.s.players[1].life, 18, "速攻は出たターンに攻撃できる");
}

// ---- ブロックと飛行 ----
const blockAll: Controller = async (_g, d) => {
  if (d.type === "blockers") return d.attackers.slice(0, d.eligible.length).map((a, i) => ({ attacker: a, blocker: d.eligible[i] }));
  return greedy(_g, d);
};
{
  const big = def("Big", "Creature — Giant", "{R}", 3, 3, "Haste");
  const small = def("Small", "Creature — Rat", "{R}", 2, 2);
  const g = setup(pad, pad, [mountain, big], [], [small]);
  (g as unknown as { controllers: Controller[] }).controllers[1] = blockAll;
  await g.play(1);
  assert.equal(g.s.players[1].life, 20, "ブロックされたらプレイヤーにダメージは通らない");
  assert.ok(g.s.players[1].graveyard.some((c) => c.def.name === "Small"), "ブロッカーが死ぬ");
  assert.ok(g.s.players[0].field.some((p) => p.def.name === "Big"), "攻撃側は生き残る");
}
{
  const flyer = def("Flyer", "Creature — Bird", "{R}", 2, 2, "Flying\nHaste");
  const ground = def("Ground", "Creature — Rat", "{R}", 2, 2);
  const g = setup(pad, pad, [mountain, flyer], [], [ground]);
  (g as unknown as { controllers: Controller[] }).controllers[1] = blockAll;
  await g.play(1);
  assert.equal(g.s.players[1].life, 18, "飛行は地上のクリーチャーにブロックされない");
}
console.log("engine ok");
