import assert from "node:assert";
import { LibAbility, PLACEHOLDER, checkAbility, expandRefs, instantiate, keywordEntries, keywordId, libMd, parseLibMd, statusOf, unknownKeyword, validateLib } from "../src/abilities";
import { parseProposal, parseRule, ruleText } from "../src/cardrules";
import { makeDef } from "../src/engine";
import { smokeTest } from "../src/diagnose";
import { smokeAbility } from "../src/abilityai";

const lib = (o: Partial<LibAbility> & { id: string }): LibAbility => validateLib({ title: o.id, effect: "x", examples: [], params: {}, ...o }).lib!;

assert.equal(keywordId("first strike"), "firstStrike");
assert.equal(keywordId("Flying"), "flying");
assert.ok(validateLib({ id: "1bad", effect: "x" }).error && validateLib({ id: "ok", effect: "" }).error, "id と effect は、必須");

// 処理は、引数を入れて展開される (既定値 + 上書き)
const drawN = lib({
  id: "etbDraw", title: "出たとき N 枚引く", effect: "戦場に出たとき、カードを {n} 枚引く", params: { n: 1 },
  ability: { kind: "triggered", trigger: { event: "etb" }, effects: [{ do: "move", what: { kind: "cards", zone: "library", owner: "you", top: true, count: "$n" }, to: "hand", how: "draw" }] },
});
const inst = (a: unknown) => ((a as { effects: { what: { count: number } }[] }).effects[0].what.count);
assert.equal(inst(instantiate(drawN)), 1, "既定の引数");
assert.equal(inst(instantiate(drawN, { n: 3 })), 3, "引数で上書き");
assert.ok(checkAbility(drawN).ok && statusOf(drawN) === "done");
assert.equal(statusOf(lib({ id: "todoOne" })), "todo", "処理が無ければ、未処理");
assert.equal(statusOf(lib({ id: "needOne", needs: [{ name: "x", title: "x", description: "x", inputs: "", state: "", waitFor: ["todo.x"] }] })), "needs", "関数が要るなら、実装待ち");
assert.ok(!checkAbility(lib({ id: "badOne", ability: { kind: "spell", effects: [{ do: "teleport" }] } })).ok, "未対応が残る処理は、処理済みにならない");
assert.equal(statusOf(keywordEntries().find((k) => k.keyword === "trample")!), "done", "エンジンのキーワードは、処理済み");
assert.equal(unknownKeyword("Kicker", new Map())?.id, "kicker", "知らないキーワードは、未処理で作る");
assert.equal(unknownKeyword("Trample", new Map()), undefined, "エンジンが動かすキーワードは、作らない");

// md の書き読み
const back = parseLibMd(libMd(drawN))!;
assert.equal(back.id, "etbDraw");
assert.deepEqual(back.params, { n: 1 });
assert.ok(libMd(drawN).includes("## 実際の効果") && libMd(drawN).includes("status: done"));

// ref の展開: 処理済み / 未処理 / 見つからない / キーワード / カード固有
const table = new Map([[drawN.id, drawN], ["todoOne", lib({ id: "todoOne", title: "未処理の能力", effect: "Does something." })], ["trample", keywordEntries().find((k) => k.keyword === "trample")!]]);
const own = { kind: "mana", cost: { tap: true }, effects: [{ do: "addMana", options: "C" }] };
const ex = expandRefs([{ ref: "etbDraw", args: { n: 2 } }, { ref: "todoOne" }, { ref: "nope" }, { ref: "trample" }, own], table);
assert.equal(ex.abilities.length, 4, "キーワードの ref は、何も足さない (エンジンのキーワードで動く)");
assert.equal(inst(ex.abilities[0]), 2);
assert.ok(JSON.stringify(ex.abilities[1]).includes(PLACEHOLDER) && JSON.stringify(ex.abilities[2]).includes("見つからない"), "未処理・見つからない能力は、未対応の印になる");
assert.equal(ex.abilities[3], own, "カード固有の能力は、そのまま");
assert.equal(ex.refs.length, 4);

// カードの記録: ref + カード固有。未処理の文は、保存された文ではなく、いまの展開から作る
const record = ruleText("Owl", "Flying\nWhen Owl enters, draw 2 cards.\nDoes something.", [], [`${PLACEHOLDER}「古い文」: stale`, "Some own line"], { by: "test", raw: [{ ref: "etbDraw", args: { n: 2 } }, { ref: "todoOne" }, own] });
let rule = parseRule(record, undefined, table)!;
assert.equal(rule.abilities.length, 3);
assert.ok(rule.unsupported.some((u) => u.includes("未処理の能力「未処理の能力」")) && rule.unsupported.includes("Some own line") && !rule.unsupported.some((u) => u.includes("古い文")), "未処理の ref は未対応になり、古い保存の文は消える");
assert.deepEqual(rule.refs?.map((r) => r.ability), ["etbDraw", "todoOne"]);
table.set("todoOne", lib({ id: "todoOne", title: "未処理の能力", effect: "Does something.", ability: { kind: "spell", effects: [{ do: "change", what: { kind: "player", who: "you" }, stat: "life", delta: 1 }] } }));
rule = parseRule(record, undefined, table)!;
assert.ok(!rule.unsupported.some((u) => u.includes("未処理の能力")), "能力が補完されたら、カードの未対応が、すぐ消える");

// 動かす: ref で書いた Thoughtseize 風の能力が、エンジンで動く
const def = makeDef({ key: "Owl", name: "Owl", typeLine: "Creature — Bird", manaCost: "{R}", cmc: 1, power: 1, toughness: 1, oracle: "", abilities: rule.abilities });
assert.equal((await smokeTest(def)).status, "ok", "ライブラリの能力から展開した処理も、動作テストに通る");

// AI の返事: 既存の能力は ref、新しい共有の能力は newAbilities、固有の能力はそのまま
const reply = JSON.stringify({
  abilities: [{ ref: "etbDraw", args: { n: 1 } }, { ref: "pingN", args: { n: 2 } }, own],
  newAbilities: [
    { id: "pingN", title: "N 点ダメージ", effect: "対象に {n} 点のダメージ", params: { n: 1 }, examples: ["~ deals {n} damage to any target."], ability: { kind: "spell", targets: [{ id: "t", sel: { kind: "any" } }], effects: [{ do: "change", what: { kind: "ref", ref: "t" }, stat: "damage", delta: "$n" }] } },
    { id: "etbDraw", effect: "重複" }, { id: "0bad", effect: "x" },
  ],
});
const p = parseProposal(reply, new Map(), new Map([[drawN.id, drawN]]));
assert.equal(p.libAbilities.length, 1, "新しい共有の能力を1つ登録する (既にある id・不正な id は、作らない)");
assert.equal(p.errors.length, 2);
assert.equal(p.raw.length, 3, "ref は、そのまま記録に残る");
assert.equal(p.abilities.length, 3, "新しい能力も、展開して読める");
assert.equal(await smokeAbility(drawN), "ok", "ライブラリの能力そのものも、仮のカードにして、動作テストできる");
assert.equal(await smokeAbility(lib({ id: "noProc" })), "failed", "処理が無い能力は、動作テストに通らない");
console.log("abilities ok");
