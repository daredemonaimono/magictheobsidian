import assert from "node:assert";
import { NODE_ROLES } from "../src/battle/nodes/keys";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { allNodes, resetRegistry } from "../src/battle/registry";
import { abilityRoles, cardRoles } from "../src/battle/roles";
import { Ability, NodeCall } from "../src/battle/node";
import { RuleBook } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

// 付け忘れ防止: すべてのノードに、役割の欄がある (役割が無い部品 (対象・条件・計算など) は、空の配列を書いて、「決めた」ことを残す)
for (const n of allNodes()) assert.ok(Array.isArray(n.roles), `${n.id}: roles が決まっていない (src/battle/nodes/keys.ts の NODE_ROLES に足す。無ければ [])`);
for (const id of Object.keys(NODE_ROLES)) assert.ok(allNodes().some((n) => n.id === id), `NODE_ROLES の ${id} が、ノードに無い`);

// 役割の導き方: 能力のノードの役割を集める。墓地で働く (zone=graveyard) や Dredge は、graveyardValue
const call = (node: string, args: NodeCall["args"] = {}): NodeCall => ({ node, args });
const rules: RuleBook = {
  get: (c) => {
    const m: Record<string, Ability[]> = {
      Bolt: [{ kind: "spell", body: [call("target", { zone: "any", kind: "any" }), call("damage", { amount: 3 })] }],
      Bazaar: [{ kind: "activated", body: [call("cost", { tap: true }), call("draw", { player: "you", count: 2 }), call("discard", { player: "you", count: 3 })] }],
      Imp: [{ kind: "static", body: [call("dredge", { amount: 5 })] }, { kind: "triggered", body: [call("when", { event: "damaged", self: true }), call("destroy", { target: { ref: "x" } })] }],
      Narco: [{ kind: "triggered", body: [call("when", { event: "moved", zone: "graveyard", self: true }), call("move", { cards: { ref: "s" }, to: "battlefield" })] }],
    };
    return m[c] ? { card: c, abilities: m[c] } : undefined;
  },
};
assert.deepEqual(abilityRoles(rules.get("Bolt")!.abilities[0]), ["damage"]);
assert.deepEqual(cardRoles(rules, "Bazaar").activated[0].sort(), ["cardAdvantage", "discard"]);
assert.deepEqual(cardRoles(rules, "Imp").all.sort(), ["graveyardValue", "removal", "replacement"].sort());
assert.ok(cardRoles(rules, "Narco").all.includes("graveyardValue"), "墓地で働く誘発は、graveyardValue");
assert.deepEqual(cardRoles(rules, "Unknown").all, [], "ルールの無いカードは、役割なし");
console.log("battle-roles ok");
