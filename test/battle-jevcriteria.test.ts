import assert from "node:assert";
import { DEFAULT_CRITERIA, MAX_QUESTIONS, chunkQuestions, toJevQuestions, validateCriteria } from "../src/battle/jevCriteria";

// 裏の JSON (src/battle/jev-criteria.json) の検査と、Jev に送る形への変換
assert.deepEqual(validateCriteria(DEFAULT_CRITERIA), [], "初期の定義は、間違いが無い");
for (const [name, d] of Object.entries(DEFAULT_CRITERIA.decisions)) assert.ok(d.questions.filter((q) => q.scope === "once").length <= MAX_QUESTIONS, `${name}: once の質問が多すぎる`);

// 間違いを見つける
const bad = JSON.parse(JSON.stringify(DEFAULT_CRITERIA));
bad.decisions.attack.questions[0].criteria = ["だけ"]; // score は 2 段階以上
bad.decisions.attack.questions[1].id = "Bad id";
bad.cards.questions[0].scope = "sometimes";
bad.decisions.block.questions.push({ ...bad.decisions.block.questions[0] }); // id の重複
const errs = validateCriteria(bad);
assert.ok(errs.some((e) => /ahead.*score/.test(e)), "score の段階が足りない");
assert.ok(errs.some((e) => /id は/.test(e)), "id の形");
assert.ok(errs.some((e) => /scope/.test(e)), "scope");
assert.ok(errs.some((e) => /重複/.test(e)), "id の重複");
assert.ok(validateCriteria(null).length && validateCriteria({ version: 2 }).length);

// 変換: once はそのまま。each は、対象ごと。{label} が置き換わる
const attackers = [{ id: "a", label: "Bear (2/2)" }, { id: "b", label: "Imp (1/2・飛行)" }];
const qs = toJevQuestions(DEFAULT_CRITERIA.decisions.attack.questions, attackers);
assert.ok(qs.ahead.type === "score" && Array.isArray(qs.ahead.criteria) && qs.ahead.criteria.length === 5, "score は、段階の配列");
assert.ok(qs.raceWinner.type === "choice" && "me" in qs.raceWinner.criteria, "choice は、選択肢");
assert.ok(qs.attackerSafe_0.instructions.includes("Bear (2/2)") && qs.attackerSafe_1.instructions.includes("Imp (1/2・飛行)") && !qs.attackerSafe_0.instructions.includes("{label}"));
assert.deepEqual(Object.keys(qs).filter((k) => k.startsWith("canBeStopped")), ["canBeStopped_0", "canBeStopped_1"]);
const noul = qs.attackerSafe_0;
assert.ok(noul.type === "noul" && noul.criteria?.true && noul.criteria?.false, "noul の true / false");

// 10 個ずつに分ける
const many = toJevQuestions(DEFAULT_CRITERIA.decisions.attack.questions, Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, label: `C${i}` })));
const chunks = chunkQuestions(many);
assert.ok(chunks.every((c) => Object.keys(c).length <= MAX_QUESTIONS) && chunks.flatMap((c) => Object.keys(c)).length === Object.keys(many).length);
console.log("battle-jevcriteria ok");
