import assert from "node:assert";
import { cardValue, heuristicDecider } from "../src/battle/aiDefaults";
import { NODE_ROLES } from "../src/battle/nodes/keys";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { NEUTRAL_ROLES, ROLE_WEIGHT, roleValue } from "../src/battle/roles";
import { parseRule } from "../src/battle/ruleMd";
import { Game, GameCard, Perm, RuleBook, StackItem, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

// 役割の重み: ノードの役割から、カードの価値・対象・生け贄を、機械的に決める
// 見張り: ノードに付いているどの役割も、重みか、「0 と決めた」(NEUTRAL_ROLES) のどちらかに入っている (新しい役割の付け忘れ防止)
for (const role of new Set(Object.values(NODE_ROLES).flat())) assert.ok(role in ROLE_WEIGHT || NEUTRAL_ROLES.includes(role), `役割 ${role}: 重みが決まっていない (src/battle/roles.ts の ROLE_WEIGHT か NEUTRAL_ROLES に足す)`);
assert.equal(roleValue([]), 0);
assert.equal(roleValue(["removal", "cardAdvantage"]), 7);
assert.equal(roleValue(["unknownRole"]), 0, "知らない役割は 0");
assert.ok(ROLE_WEIGHT.removal > ROLE_WEIGHT.evasion && ROLE_WEIGHT.graveyardValue < 0);

const md = (name: string, body: string) => parseRule(`---\nmtg: rule\ncard: "[[${name}]]"\n---\n\n${body}`);
const rs = new Map([
  ["Shade", md("Shade", "## 常在型能力\n\n- cantBeBlocked\n")], // 回避
  ["Season", md("Season", "## 常在型能力\n\n- modifyAmount what=tokens who=you mult=2\n")], // 置換
  ["Bolt", md("Bolt", "## 呪文能力\n\n- target as=t zone=any kind=any\n- damage target=$t amount=3\n")], // 除去ではなく、ダメージ
  ["Edict", md("Edict", "## 呪文能力\n\n- target as=t zone=player kind=player\n- playerRemoves player=target target=$t type=creature how=sacrifice\n")], // 除去
  ["Gy", md("Gy", "## 誘発型能力\n\n- when event=moved zone=graveyard self=true\n- self as=s\n- move cards=$s to=battlefield\n")], // 墓地で働く
]);
const rules: RuleBook = { get: (c) => rs.get(c) };
const card = (id: string, name: string, typeLine: string, owner: string, extra: Partial<GameCard> = {}): GameCard => ({ id, name, typeLine, mv: 2, owner, power: 2, toughness: 2, ...extra });
const g = createGame(["you", "ai"]);
for (let i = 0; i < 5; i++) g.battlefield.push({ id: `L${i}`, card: card(`L${i}`, "Island", "Basic Land — Island", "ai", { mv: 0, power: undefined, toughness: undefined }), controller: "ai" });

// 手札の価値: 除去 > 回避・置換 > ふつう > 墓地で働く
const v = (name: string) => cardValue(g, "ai", card("x", name, "Creature — Bear", "ai"), rules);
assert.ok(v("Edict") > v("Shade") && v("Shade") > v("Vanilla") && v("Vanilla") > v("Gy"), `価値の順: Edict ${v("Edict")} / Shade ${v("Shade")} / Vanilla ${v("Vanilla")} / Gy ${v("Gy")}`);
assert.ok(v("Season") > v("Vanilla"), "置換効果は、ふつうより高い");
assert.ok(v("Bolt") > v("Vanilla"), "ダメージは、ふつうより高い");
// 捨てる: 価値の低い (墓地で働く) から
g.hands["ai"] = [card("h1", "Edict", "Sorcery", "ai"), card("h2", "Gy", "Creature — Bear", "ai"), card("h3", "Vanilla", "Creature — Bear", "ai")];
assert.deepEqual(heuristicDecider("you", rules).discard!(g, "ai", 2)!.map((c) => c.id).sort(), ["h2", "h3"], "除去は残して、墓地で働くものとふつうのものを捨てる");
// 対象: 強さが同じなら、役割のある (回避・置換) ものを先に除去する
const foeA: Perm = { id: "fa", card: card("fa", "Vanilla", "Creature — Bear", "you"), controller: "you" };
const foeB: Perm = { id: "fb", card: card("fb", "Shade", "Creature — Shade", "you"), controller: "you" };
const foeC: Perm = { id: "fc", card: card("fc", "Season", "Creature — Wizard", "you"), controller: "you" };
g.battlefield.push(foeA, foeB, foeC);
const item: StackItem = { id: "s", card: card("Src", "Src", "Sorcery", "ai"), controller: "ai", targets: {}, cast: {}, body: [{ node: "target", args: {}, as: "t" }, { node: "destroy", args: { target: { ref: "t" } } }] };
const pick = (legal: string[]) => heuristicDecider("you", rules).target!(g, item, item.body![0], legal)?.[0];
assert.equal(pick(["fa", "fb"]), "fb", "強さが同じなら、回避を持つほうを除去する");
assert.equal(pick(["fa", "fc"]), "fc", "置換効果のあるほうを先に除去する");
// 生け贄: 自分の価値の低いものから (役割のあるものは残す)
const mineA: Perm = { id: "ma", card: card("ma", "Vanilla", "Creature — Bear", "ai"), controller: "ai" };
const mineB: Perm = { id: "mb", card: card("mb", "Season", "Creature — Wizard", "ai"), controller: "ai" };
g.battlefield.push(mineA, mineB);
assert.deepEqual(heuristicDecider("you", rules).choose!(g, "ai", [mineB.card, mineA.card], 1, false, "sacrifice")!.map((c) => c.id), ["ma"], "置換効果を持つほうは残して、ふつうのほうを生け贄にする");
console.log("battle-roleweight ok");
