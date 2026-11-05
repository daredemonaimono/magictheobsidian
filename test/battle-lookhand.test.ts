import assert from "node:assert";
import { parseRule } from "../src/battle/ruleMd";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { BattleController } from "../src/battle/play";
import { resetRegistry } from "../src/battle/registry";
import { checkCall } from "../src/battle/registry";
import { GameCard, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();
// 「相手の手札を見て、クリーチャーでも土地でもないカードを1枚選んで、捨てさせる」(Duress と同じ形): 新しいノードは lookHand だけ。あとは、filter・choose・move の組み合わせ
const duress = parseRule(`---
mtg: rule
card: "[[Duress]]"
---

## 呪文能力

- lookHand player=opponents as=h
- filter from=$h notType=creature|land as=f
- choose from=$f count=1 as=c
- move cards=$c to=graveyard
`);
assert.equal(checkCall({ node: "lookHand", args: { player: "opponents" } }), null);
const rules: RuleBook = { get: (c) => (c === "Duress" ? duress : undefined) };
const mk = (id: string, t: string, owner: string, extra: Partial<GameCard> = {}): GameCard => ({ id, name: id, typeLine: t, mv: 1, owner, ...extra });
const g = createGame(["you", "opp"]);
g.payManaCosts = true;
g.step = "main1";
g.libraries["you"] = [mk("L", "Land", "you")];
g.libraries["opp"] = [mk("O", "Land", "opp")];
g.mana["you"] = 1;
g.pool["you"] = { B: 1 };
g.hands["you"] = [mk("Duress", "Sorcery", "you", { manaCost: "{B}" })];
g.hands["opp"] = [mk("Bear", "Creature — Bear", "opp"), mk("Island", "Basic Land — Island", "opp"), mk("Zap", "Instant", "opp"), mk("Counter", "Instant", "opp")];
const c = new BattleController(g, rules);
assert.equal(c.use("Duress"), undefined);
c.next();
const req = c.pending?.request;
assert.ok(req && req.kind === "choose", "選ぶ質問が出る");
assert.deepEqual(req.cards.map((x) => x.id), ["Zap", "Counter"], "クリーチャーと土地は、選べない");
assert.equal(c.answer(["Counter"]), undefined);
assert.deepEqual(g.graveyards["opp"].map((x) => x.id), ["Counter"], "選んだカードが、相手の墓地へ");
assert.deepEqual(g.hands["opp"].map((x) => x.id), ["Bear", "Island", "Zap"]);
// 見たことが、残る (画面が、相手の手札を前に出すのに使う)
assert.deepEqual(g.handLook, { by: "you", of: "opp", ids: ["Bear", "Island", "Zap", "Counter"], n: 1 });
assert.ok(g.log.some((l) => l.startsWith("相手の手札を見た: Bear、Island、Zap、Counter")));
// 手札が無い相手でも、落ちない
{
  const h = createGame(["you", "opp"]);
  h.payManaCosts = true;
  h.step = "main1";
  h.libraries["you"] = [mk("L", "Land", "you")];
  h.libraries["opp"] = [mk("O", "Land", "opp")];
  h.mana["you"] = 1;
  h.pool["you"] = { B: 1 };
  h.hands["you"] = [mk("Duress", "Sorcery", "you", { manaCost: "{B}" })];
  const d = new BattleController(h, rules);
  assert.equal(d.use("Duress"), undefined);
  d.next();
  assert.equal(d.pending, undefined);
  assert.ok(h.log.some((l) => l.includes("手札が無い")));
}
console.log("lookhand ok");
