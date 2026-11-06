import assert from "node:assert";
import { compactLog } from "../src/battle/aiLog";

// AI に渡すログ: 向きをそろえ、要らない行を除き、決まり文句を短くする
const log = [
  "ターン 36: 相手のターン",
  "あなたが島をタップして {U} を出した",
  "あなたが Noble Hierarch を唱えた",
  "あなたが Noble Hierarch で攻撃した",
  "相手 (AI) のトークン: 入力 1234 / 出力 56 (この対戦の合計 9999)",
  "相手が Oko, Thief of Crowns の能力 +2: トークンを作る を起動した",
  "相手が Food (トークン) を作った",
  "相手が Goblin Raider でブロックした",
  "あなたが Mox Emerald を出した",
  "Wasteland を生け贄に捧げた",
];
// 先手 (人) の視点のまま
assert.deepEqual(compactLog(log, false), [
  "T36 相手",
  "あなた: 唱 Noble Hierarch",
  "あなた: 攻撃 Noble Hierarch",
  "相手: 起動 Oko, Thief of Crowns +2: トークンを作る",
  "相手が Food (トークン) を作った",
  "相手: ブロック Goblin Raider で",
  "あなた: 出 Mox Emerald",
  "生贄 Wasteland",
], "記録用の行とマナのタップは除く。決まり文句は短く");
// AI が後手: 「あなた」は AI 自身なので、人のことは「相手」になる
const flipped = compactLog(log, true);
assert.equal(flipped[0], "T36 あなた", "ターンの持ち主も、AI から見た呼び方に");
assert.equal(flipped[1], "相手: 唱 Noble Hierarch", "人が唱えたものは、AI から見て『相手』");
assert.equal(flipped[3], "あなた: 起動 Oko, Thief of Crowns +2: トークンを作る", "AI 自身の行動は『あなた』");
assert.equal(flipped[4], "あなたが Food (トークン) を作った");
// 文字数: 同じ内容で、短くなる
const before = log.join("\n").length;
const after = compactLog(log, true).join("\n").length;
assert.ok(after < before * 0.75, `短くなる: ${before} → ${after}`);
console.log(`ailog ok (${before} → ${after} 文字)`);
