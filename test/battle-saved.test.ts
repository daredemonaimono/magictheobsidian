import assert from "node:assert";
import { SavedBattle, battleNote, battleNoteName, parseBattleNote } from "../src/battle/saved";

const b: SavedBattle = {
  version: 1,
  self: "Gentry Mono U",
  opp: "Mirror",
  seed: 12345,
  mode: "claude",
  model: "claude-sonnet-5-5",
  result: "win",
  turns: 9,
  tokens: { input: 1000, output: 200 },
  date: "2026-11-05T14:30:00.000Z",
  entries: [{ op: "keep", args: [] }, { op: "use", args: ["Bear#1", null, null, null], answers: [["x"]] }, { op: "next", args: [] }],
  log: ["ターン 1: あなたのターン", "あなたが Island を出した", "相手の考え: 土地 - 「テスト」"],
};
const md = battleNote(b);
assert.ok(md.startsWith("---\nmtg: battle\n"));
assert.ok(md.includes("# Gentry Mono U vs Mirror (勝ち、9 ターン)"));
assert.deepEqual(parseBattleNote(md), b, "書いて読み戻すと、同じ");
assert.equal(parseBattleNote("ふつうのノート"), undefined);
assert.equal(parseBattleNote(md.replace('"version":1', '"version":2')), undefined);
assert.equal(battleNoteName(b), "20261105-1430 Gentry Mono U vs Mirror.md");
assert.equal(battleNoteName({ ...b, opp: 'A/B:C' }), "20261105-1430 Gentry Mono U vs A_B_C.md");
// 途中の対戦 (トークン・モデルなし)
const u: SavedBattle = { ...b, result: "unfinished", mode: "cpu" };
delete u.model;
delete u.tokens;
assert.deepEqual(parseBattleNote(battleNote(u)), u);
console.log("saved ok");
