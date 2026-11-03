import assert from "node:assert";
import { Ability, Block, CardDef, Controller, Decision, Game, Perm, PriorityAction, makeDef, parseCost, parseKeywords, parseMana, planPayment } from "../src/engine";

const def = (name: string, typeLine: string, manaCost: string, power = 0, toughness = 0, oracle = "", abilities?: Ability[]): CardDef =>
  makeDef({ key: name, name, typeLine, manaCost, cmc: (manaCost.match(/\{[^}]+\}/g) ?? []).length, power, toughness, oracle, abilities });
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
  const g = new Game([deck, deck], 1, [greedy, greedy], { opening: false });
  await g.play(80);
  assert.notEqual(g.s.winner, undefined, "決着がつく");
  const lands = g.s.log.filter((l) => l.includes("土地を出す")).length;
  assert.ok(lands <= g.s.turn, "土地は1ターンに1枚まで");
  // 同じ seed なら同じ展開
  const g2 = new Game([deck, deck], 1, [greedy, greedy], { opening: false });
  await g2.play(80);
  assert.deepEqual(g2.s.log, g.s.log);
}

// ---- 召喚酔いと速攻 ----
const setup = (a: CardDef[], b: CardDef[], handA: CardDef[], handB: CardDef[] = [], fieldB: CardDef[] = []) => {
  const g = new Game([a, b], 7, [greedy, greedy], { opening: false });
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
  if (d.type === "blockers") {
    const used = new Set<number>();
    return d.legal.filter((l) => !used.has(l.blocker) && used.add(l.blocker)); // ブロックできるものは全部ブロックする
  }
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

// ---- マナプールと手動のタップ ----
const mkPerm = (d: CardDef, uid: number, owner: number): Perm => ({ uid, def: d, owner, controller: owner, tapped: false, sick: false, damage: 0, attacking: false });
const world = (handA: CardDef[], fieldA: CardDef[], controllers: Controller[], manual = [true, false]) => {
  const g = new Game([pad, pad], 3, controllers, { manual, opening: false });
  let uid = 2000;
  g.s.players[0].hand = handA.map((d) => ({ uid: uid++, def: d, owner: 0 }));
  g.s.players[0].field = fieldA.map((d) => mkPerm(d, uid++, 0));
  g.s.players[1].hand = [];
  return g;
};
const swamp = def("Swamp", "Basic Land — Swamp", "");
const pass: PriorityAction = { kind: "pass" };
{
  // 手動: 土地をタップ → マナプール → 唱える (プールだけで払える)
  const cub = def("Cub", "Creature — Bear", "{R}", 2, 2);
  const seen: string[] = [];
  const me: Controller = async (_g, d) => {
    if (d.type !== "priority") return d.type === "attackers" ? [] : ([] as Block[]);
    const t = d.actions.find((a) => a.kind === "tapMana");
    const cast = d.actions.find((a) => a.kind === "cast" && a.tap.length === 0);
    if (cast) {
      seen.push("cast tap=0");
      return cast;
    }
    return t ?? pass;
  };
  const g = world([cub], [mountain], [me, greedy]);
  await g.play(1);
  assert.deepEqual(seen, ["cast tap=0"].slice(0, seen.length));
  assert.ok(g.s.players[0].field.some((p) => p.def.name === "Cub"), "タップしたマナで唱えられた");
  assert.deepEqual(g.s.players[0].pool, [], "プールはステップの終わりに空になる");
}
{
  // 手動のプレイヤーには、プールが空でも「タップすれば唱えられる」カードが出る (tap が空でない)
  const cub = def("Cub", "Creature — Bear", "{R}", 2, 2);
  let first: PriorityAction | undefined;
  const me: Controller = async (_g, d) => {
    if (d.type === "priority") first ??= d.actions.find((a) => a.kind === "cast");
    return d.type === "priority" ? pass : d.type === "attackers" ? [] : ([] as Block[]);
  };
  const g = world([cub], [mountain], [me, greedy]);
  g.s.phase = "main1";
  const acts = g.actions(0);
  assert.ok(acts.some((a) => a.kind === "tapMana"));
  assert.equal((acts.find((a) => a.kind === "cast") as { tap: number[] }).tap.length, 1);
  void first;
}
{
  // Dark Ritual (呪文でマナを出す) → プールで3マナの呪文を唱える。Black Lotus (生け贄 + 色の選択)
  const ritual = def("Dark Ritual", "Instant", "{B}", 0, 0, "", [{ kind: "spell", effects: [{ op: "addMana", options: "B", n: 3 }] }]);
  const zombie = def("Zombie", "Creature — Zombie", "{B}{B}{B}", 3, 3);
  const lotus = def("Lotus", "Artifact", "{0}", 0, 0, "", [{ kind: "mana", cost: { tap: true, sacrificeSelf: true }, effects: [{ op: "addMana", options: "WUBRG", n: 3 }] }]);
  const me: Controller = async (g, d) => {
    if (d.type === "choice") return d.options.indexOf("B");
    if (d.type !== "priority") return d.type === "attackers" ? [] : ([] as Block[]);
    if (g.s.phase !== "main1") return pass;
    const cast = d.actions.find((a) => a.kind === "cast" && (a as { uid: number }).uid && g.card(a.uid)?.def.name === "Zombie" && a.tap.length === 0);
    if (cast) return cast;
    const lot = d.actions.find((a) => a.kind === "activate");
    if (lot) return lot;
    const rit = d.actions.find((a) => a.kind === "cast" && g.card(a.uid)?.def.name === "Dark Ritual");
    const tap = d.actions.find((a) => a.kind === "tapMana");
    if (g.s.stack.length === 0 && rit && g.s.players[0].pool.length > 0 && !g.s.players[0].field.some((p) => p.def.name === "Zombie")) return rit;
    return tap ?? pass;
  };
  const g = world([ritual, zombie], [swamp], [me, greedy]);
  g.s.phase = "main1";
  await g.play(1);
  assert.ok(g.s.players[0].field.some((p) => p.def.name === "Zombie"), "Swamp → Dark Ritual → BBB で Zombie");
  const g2 = world([zombie], [lotus], [me, greedy]);
  await g2.play(1);
  assert.ok(g2.s.players[0].field.some((p) => p.def.name === "Zombie"), "Black Lotus を生け贄にして BBB");
  assert.ok(!g2.s.players[0].field.some((p) => p.def.name === "Lotus"), "Lotus は墓地へ");
}

// ---- 誘発 (アップキープのコイン投げ) と、出たときの誘発 ----
{
  const crypt2 = def("Crypt", "Artifact", "{0}", 0, 0, "", [
    { kind: "triggered", trigger: { event: "upkeep", whose: "you" }, effects: [{ op: "flip", lose: [{ op: "damage", n: 3, to: "you" }] }] },
  ]);
  const run = async () => {
    const g = world([], [crypt2], [greedy, greedy], [false, false]);
    await g.play(8);
    return g;
  };
  const g = await run();
  const flips = g.s.log.filter((l) => l.startsWith("コイン投げ")).length;
  assert.equal(flips, 4, "自分のアップキープ (ターン 1,3,5,7) ごとに1回");
  const lost = g.s.log.filter((l) => l === "コイン投げ: 負け").length;
  assert.equal(g.s.players[0].life, 20 - 3 * lost, "負けた回数だけ3点");
  assert.deepEqual((await run()).s.log, g.s.log, "同じ seed なら、コイン投げも同じ");
}
{
  const owl = def("Owl", "Creature — Bird", "{R}", 1, 1, "", [{ kind: "triggered", trigger: { event: "etb" }, effects: [{ op: "draw", n: 2 }] }]);
  const g = world([mountain, owl], [], [greedy, greedy], [false, false]);
  const before = g.s.players[0].library.length;
  await g.play(1);
  assert.equal(g.s.players[0].library.length, before - 2, "出たときに2枚引く");
}
// ---- 対象を選ぶ効果 ----
{
  const bolt = def("Bolt", "Instant", "{R}", 0, 0, "", [{ kind: "spell", effects: [{ op: "destroy", target: { controller: "opponent", types: ["creature"] } }] }]);
  const wolf = def("Wolf", "Creature — Wolf", "{G}", 2, 2);
  const asked: Decision[] = [];
  const me: Controller = async (_g, d) => {
    if (d.type === "choice") return asked.push(d), 0;
    if (d.type === "priority") return d.actions.find((a) => a.kind === "land") ?? d.actions.find((a) => a.kind === "cast") ?? pass;
    return d.type === "attackers" ? [] : ([] as Block[]);
  };
  const g = world([mountain, bolt], [], [me, greedy], [false, false]);
  g.s.players[1].field = [mkPerm(wolf, 5000, 1)];
  await g.play(1);
  assert.equal(g.s.players[1].field.length, 0, "対象が1つなら聞かずに破壊する");
  assert.equal(asked.length, 0);
  assert.ok(g.s.players[1].graveyard.some((c) => c.def.name === "Wolf"));
}

// ---- 戦闘のキーワード ----
const fight = async (atk: CardDef, blockers: CardDef[], opts: { blocks?: boolean; defenderLands?: CardDef[] } = {}) => {
  const hasty = def(atk.name, atk.typeLine, "{R}", atk.power, atk.toughness, `${atk.oracle}\nHaste`);
  const g = setup(pad, pad, [mountain, hasty], [], [...blockers, ...(opts.defenderLands ?? [])]);
  (g as unknown as { controllers: Controller[] }).controllers[1] = opts.blocks === false ? greedy : blockAll;
  await g.play(1);
  return g;
};
const gone = (g: Game, player: number, name: string) => !g.s.players[player].field.some((p) => p.def.name === name);
const rat = (n = "Rat", pw = 2, th = 2, oracle = "", type = "Creature — Rat") => def(n, type, "{R}", pw, th, oracle);
{
  let g = await fight(rat("Trampler", 4, 4, "Trample"), [rat("Block", 2, 2)]);
  assert.ok(gone(g, 1, "Block") && g.s.players[1].life === 18, "トランプル: 致死の分を割り振って、あまりがプレイヤーへ");
  g = await fight(rat("First", 2, 2, "First strike"), [rat("Block", 2, 2)]);
  assert.ok(gone(g, 1, "Block") && !gone(g, 0, "First"), "先制攻撃: 先に倒して反撃を受けない");
  g = await fight(rat("Double", 2, 2, "Double strike"), []);
  assert.equal(g.s.players[1].life, 16, "二段攻撃: 2回与える");
  g = await fight(rat("Toucher", 1, 1, "Deathtouch"), [rat("Big", 5, 5)]);
  assert.ok(gone(g, 1, "Big"), "接死: 1点で倒す");
  g = await fight(rat("Linker", 3, 3, "Lifelink"), []);
  assert.deepEqual([g.s.players[0].life, g.s.players[1].life], [23, 17], "絆魂");
  g = await fight(rat("Menacer", 2, 2, "Menace"), [rat("One")]);
  assert.equal(g.s.players[1].life, 18, "威迫: 1体ではブロックできない");
  g = await fight(rat("Menacer", 2, 2, "Menace"), [rat("One"), rat("Two")]);
  assert.equal(g.s.players[1].life, 20, "威迫: 2体ならブロックできる");
  g = await fight(rat("Wall", 0, 4, "Defender\nHaste"), []);
  assert.equal(g.s.players[1].life, 20, "防衛は攻撃できない");
  g = await fight(rat("Immortal", 1, 1, "Indestructible"), [rat("Big", 5, 5)]);
  assert.ok(!gone(g, 0, "Immortal"), "破壊不能は致死ダメージで死なない");
  g = await fight(rat("Feary", 2, 2, "Fear"), [rat("Plain")]);
  assert.equal(g.s.players[1].life, 18, "畏怖: 黒でも artifact でもないとブロックできない");
  g = await fight(rat("Skulker", 2, 2, "Skulk"), [rat("Bigger", 3, 3)]);
  assert.equal(g.s.players[1].life, 18, "忍び足: パワーの大きいクリーチャーはブロックできない");
  g = await fight(rat("Shady", 2, 2, "Shadow"), [rat("Plain")]);
  assert.equal(g.s.players[1].life, 18, "影: 影でないクリーチャーはブロックできない");
  const island = def("Island", "Basic Land — Island", "");
  g = await fight(rat("Walker", 2, 2, "Islandwalk"), [rat("Plain")], { defenderLands: [island] });
  assert.equal(g.s.players[1].life, 18, "島渡り: 相手が島を持つとブロックされない");
}
{
  const hex = rat("Hex", 2, 2, "Hexproof");
  const kill = def("Kill", "Instant", "{R}", 0, 0, "", [{ kind: "spell", effects: [{ op: "destroy", target: { controller: "opponent", types: ["creature"] } }] }]);
  const g = setup(pad, pad, [mountain, kill], [], [hex]);
  await g.play(1);
  assert.ok(!gone(g, 1, "Hex"), "呪禁は相手の対象にならない");
  const plain = setup(pad, pad, [mountain, kill], [], [rat("Plain")]);
  await plain.play(1);
  assert.ok(gone(plain, 1, "Plain"), "(対照) 呪禁が無ければ破壊される");
}

// ---- ダイス・マリガン・手札上限・タップインの土地 ----
{
  const asked: string[] = [];
  let mulls = 0;
  const me: Controller = async (g, d) => {
    if (d.type === "choice") {
      asked.push(d.prompt);
      if (d.prompt.startsWith("初手をキープ")) return mulls++ < 1 ? 1 : 0; // 1回マリガンしてキープ
      return 0;
    }
    return greedy(g, d);
  };
  const deck = [...Array(24).fill(mountain), ...Array(16).fill(bear)];
  const g = new Game([deck, deck], 5, [me, greedy], { first: 0 });
  await g.play(0); // 初手だけ
  assert.equal(g.s.players[0].hand.length, 6, "1回マリガンで 7 - 1 = 6 枚");
  assert.equal(g.s.players[0].library.length, 34, "引き直した 7 枚 + 下に戻した 1 枚");
  assert.ok(asked.some((p) => p.startsWith("ライブラリーの下に置く")), "下に置くカードを選ぶ");
  assert.ok(g.s.log.some((l) => l.includes("マリガン (1 回目)")));
}
{
  const answers: [number, string][] = [];
  const pick = (who: number): Controller => async (g, d) => {
    if (d.type === "choice" && d.prompt.startsWith("ダイスに勝った")) return answers.push([who, d.prompt]), 1; // 後攻を選ぶ
    return greedy(g, d);
  };
  const deck = [...Array(24).fill(mountain), ...Array(16).fill(bear)];
  const g = new Game([deck, deck], 9, [pick(0), pick(1)]);
  await g.play(1);
  assert.equal(answers.length, 1, "ダイスに勝った人だけが選ぶ");
  assert.equal(g.s.active, 1 - answers[0][0], "後攻を選ぶと、相手が先攻");
}
{
  const zed = def("Zed", "Instant", "{9}", 0, 0);
  const prompts: string[] = [];
  const me: Controller = async (g, d) => {
    if (d.type === "choice") {
      prompts.push(d.prompt);
      return d.options.indexOf("Zed") >= 0 ? d.options.indexOf("Zed") : 0;
    }
    return d.type === "priority" ? pass : d.type === "attackers" ? [] : ([] as Block[]);
  };
  const g = world([...Array(8).fill(mountain), zed], [], [me, greedy], [false, false]);
  await g.play(1);
  assert.equal(prompts.length, 2, "手札 9 枚 → 7 枚まで、2 枚を自分で選んで捨てる");
  assert.ok(g.s.players[0].graveyard.some((c) => c.def.name === "Zed"), "選んだカードが捨てられる");
  assert.equal(g.s.players[0].hand.length, 7);
}
{
  const tapland = def("Tapland", "Land", "", 0, 0, "Tapland enters tapped.\n{T}: Add {R}.");
  const g = world([tapland], [], [greedy, greedy], [false, false]);
  await g.play(1);
  const land = g.s.players[0].field.find((p) => p.def.name === "Tapland");
  assert.ok(land?.tapped, "タップ状態で出る土地");
  assert.equal(def("Shock", "Land", "", 0, 0, "You may pay 2 life. If you don't, Shock enters tapped.").entersTapped, false, "条件つきは読まない");
}

// ---- 手動のプレイヤーは、止まると決めたステップでだけ優先権を聞かれる ----
{
  const ritual = def("Dark Ritual", "Instant", "{B}", 0, 0, "", [{ kind: "spell", effects: [{ op: "addMana", options: "B", n: 3 }] }]);
  const run = async (stops?: import("../src/engine").Phase[]) => {
    const phases: string[] = [];
    const me: Controller = async (_g, d) => {
      if (d.type === "priority") phases.push(_g.s.phase);
      return d.type === "priority" ? pass : d.type === "attackers" ? [] : ([] as Block[]);
    };
    const g = new Game([pad, pad], 3, [me, greedy], { manual: [true, false], opening: false, first: 0, stops });
    g.s.players[0].hand = [{ uid: 9001, def: ritual, owner: 0 }];
    g.s.players[0].field = [mkPerm(swamp, 9002, 0)];
    await g.play(1);
    return phases;
  };
  const byDefault = await run();
  assert.ok(!byDefault.includes("upkeep") && byDefault.includes("main1"), "既定では、アップキープでは止まらず、メインで止まる");
  assert.ok((await run(["upkeep"])).includes("upkeep"), "止まるステップにすれば、アップキープでも聞かれる");
}

// ---- 手札を捨てさせる (Thoughtseize) ----
{
  const seize = def("Thoughtseize", "Sorcery", "{B}", 0, 0, "", [
    { kind: "spell", effects: [{ op: "discard", n: 1, who: "opponent", chooser: "you", nonland: true }, { op: "loseLife", n: 2, who: "you" }] },
  ]);
  const big = def("BigSpell", "Creature — Dragon", "{5}{R}{R}", 6, 6);
  const small = def("SmallSpell", "Creature — Rat", "{3}{R}", 1, 1);
  const options: string[][] = [];
  const me: Controller = async (g, d) => {
    if (d.type === "choice") return options.push(d.options), d.options.indexOf("BigSpell");
    if (d.type === "priority") return d.actions.find((a) => a.kind === "cast") ?? pass;
    return d.type === "attackers" ? [] : ([] as Block[]);
  };
  const g = world([seize], [swamp], [me, greedy], [false, false]);
  g.s.players[1].hand = [mountain, big, small].map((d, i) => ({ uid: 7000 + i, def: d, owner: 1 }));
  await g.play(1);
  assert.deepEqual(options[0].sort(), ["BigSpell", "SmallSpell"], "土地は選べない (nonland)");
  assert.ok(g.s.players[1].graveyard.some((c) => c.def.name === "BigSpell"), "選んだカードが捨てられる");
  assert.equal(g.s.players[0].life, 18, "2 点失う");
}
console.log("engine ok");

// ---- 処理の記録の読み取り ----
{
  const { sanitizeAbilities, needsRule } = await import("../src/cardrules");
  const abs = sanitizeAbilities([
    { kind: "triggered", trigger: { event: "upkeep" }, effects: [{ op: "flip", lose: [{ op: "damage", n: 3, to: "you" }] }] },
    { kind: "spell", effects: [{ op: "teleport", text: "x" }, { op: "addMana", options: "Z" }] },
    { kind: "bogus", effects: [] },
    { kind: "triggered", trigger: { event: "attacks" }, effects: [] },
  ]);
  assert.equal(abs.length, 2, "知らない種類・きっかけの能力は捨てる");
  assert.equal(abs[0].trigger?.whose, "you");
  assert.deepEqual(abs[1].effects.map((e) => e.op), ["unsupported", "unsupported"], "知らない効果は未対応にする");
  assert.equal(needsRule("Basic Land — Swamp", ""), false);
  assert.equal(needsRule("Creature — Bird", "Flying\nHaste"), false);
  assert.equal(needsRule("Creature — Bird", "Flying\nWhen this enters, draw a card."), true);
  console.log("rules ok");
}
