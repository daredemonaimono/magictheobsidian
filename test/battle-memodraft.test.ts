import assert from "node:assert";
import { DRAFT_SYSTEM, condenseLog, deckResult, draftPrompt, matchesOf } from "../src/battle/memoDraft";
import { SavedBattle } from "../src/battle/saved";

const b = (extra: Partial<SavedBattle> = {}): SavedBattle => ({ version: 1, self: "Mine", opp: "Gentry", seed: 1, mode: "claude", result: "win", turns: 9, date: "2026-11-05T10:00:00.000Z", entries: [], log: ["ターン 1: あなたのターン", "あなたが Island をタップしてマナを出した", "相手 (AI) のトークン: 入力 1 / 出力 2 (この対戦の合計 3)", "相手が Bear を唱えた"], ...extra });
// 勝敗は、そのデッキから見る: 人の側なら、そのまま。相手 (AI) 側なら、逆
assert.equal(deckResult("Mine", b()), "win");
assert.equal(deckResult("Gentry", b()), "lose");
assert.equal(deckResult("Gentry", b({ result: "lose" })), "win");
assert.equal(deckResult("Gentry", b({ result: "draw" })), "draw");
assert.equal(deckResult("Gentry", b({ result: "unfinished" })), "unfinished");
// そのデッキが出てくる試合だけ
assert.equal(matchesOf("Gentry", [b(), b({ opp: "Other" }), b({ self: "Gentry", opp: "X" })]).length, 2);
// ログの要点: ノイズ (トークン・マナのタップ) を除く。長ければ、省略
assert.deepEqual(condenseLog(b().log), ["ターン 1: あなたのターン", "相手が Bear を唱えた"]);
const long = Array.from({ length: 300 }, (_, i) => `行 ${i}`);
const c = condenseLog(long);
assert.equal(c.length, 151);
assert.ok(c[40].includes("省略") && c[0] === "行 0" && c[150] === "行 299");
// 下書きの頼み: 勝敗・相手・使った側・AI の理由 (AI が使った試合だけ)・今のメモ
const p = draftPrompt("Gentry", "土地2枚ならマリガン", [b({ notes: [{ n: 1, why: "土地を先に置く" }] }), b({ self: "Gentry", opp: "Mine", result: "win" })]);
assert.ok(p.includes("今のメモ:\n土地2枚ならマリガン"));
assert.ok(p.includes("試合 1: Gentry は 負け (9 ターン)。相手のデッキ: Mine。Gentry を使った側: AI"));
assert.ok(p.includes("AI が返した理由 (抜粋): 土地を先に置く"));
assert.ok(p.includes("試合 2: Gentry は 勝ち") && p.includes("Gentry を使った側: 人"));
assert.equal(p.split("AI が返した理由").length - 1, 1, "人が使った試合には、理由を付けない");
assert.ok(draftPrompt("Gentry", "", []).includes("今のメモ: (まだ無い)"));
assert.ok(DRAFT_SYSTEM.includes("記録に根拠のあること"));
console.log("memodraft ok");
