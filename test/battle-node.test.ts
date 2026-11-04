import assert from "node:assert";
import { allNodes, checkCall, defineNode, getNode, resetRegistry } from "../src/battle/registry";

resetRegistry();
const base = { title: "テスト", summary: "テスト用", outputs: {} };

// 定義したノードは引ける。同じ id の二重定義は禁止
defineNode({ ...base, id: "t", params: { n: { type: "number", required: true }, k: { type: "string", choices: ["a", "b"] }, r: { type: "ref" } } });
assert.equal(getNode("t")?.id, "t");
assert.equal(allNodes().length, 1);
assert.throws(() => defineNode({ ...base, id: "t", params: {} }));

// 呼び出しの検証: 問題なければ null、あれば日本語の理由
assert.equal(checkCall({ node: "t", args: { n: 1 } }), null);
assert.ok(checkCall({ node: "nope", args: {} })?.includes("未知のノード: nope"));
assert.ok(checkCall({ node: "t", args: {} })?.includes("必須の引数がない: n"));
assert.ok(checkCall({ node: "t", args: { n: 1, k: "z" } })?.includes("選べない値"));
assert.ok(checkCall({ node: "t", args: { n: "x" } })?.includes("型が違う"));
assert.ok(checkCall({ node: "t", args: { n: 1, zzz: 1 } })?.includes("未知の引数: zzz"));

// ref は type:"ref" の引数でだけ通る
assert.equal(checkCall({ node: "t", args: { n: 1, r: { ref: "x" } } }), null);
assert.ok(checkCall({ node: "t", args: { n: { ref: "x" } } })?.includes("型が違う"));
assert.ok(checkCall({ node: "t", args: { n: 1, r: "x" } })?.includes("型が違う"));

resetRegistry();
assert.equal(allNodes().length, 0);
