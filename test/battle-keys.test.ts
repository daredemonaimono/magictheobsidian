import assert from "node:assert";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { NODE_KEYS } from "../src/battle/nodes/keys";
import { allNodes, resetRegistry } from "../src/battle/registry";
import { buildPrompt, selectSystem } from "../src/battle/prompt";

resetRegistry();
registerBuiltinNodes();

// 表の id は、全部ノードにあり、keys が付いている
const byId = new Map(allNodes().map((n) => [n.id, n]));
for (const id of Object.keys(NODE_KEYS)) assert.ok(byId.get(id)?.keys?.length, `${id}: keys が付いていない`);
// ルールを書かせる AI へのノード一覧に、言い方が出る。ヒント (機械的に切った結果) は、付けない
const { system, user } = buildPrompt("Ancestral Recall", "Instant\n\nTarget player draws three cards.");
assert.match(selectSystem(), /言い方: 引く/);
assert.ok(!(system + user).includes("機械的に切った結果"));
console.log("battle-keys ok");
