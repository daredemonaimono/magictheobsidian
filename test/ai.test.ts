import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { composeAbility, userPrompt } from "../src/ai/compose";
import { auditAbility, auditCard } from "../src/node/audit";
import { EXAMPLES } from "../src/ai/examples";
import { renderGuide } from "../src/ai/guide";
import { Http, Msg, chatRequest, chatText, modelIds, modelsRequest } from "../src/ai/providers";
import { FENCE_OPEN, prismGrammar, tokenize } from "../src/highlight/tokens";
import { setLang } from "../src/i18n";
import { abilityBlock, extractNodeBlock, parseAbility } from "../src/node/card";
import { NodeData } from "../src/node/md";
import { validate } from "../src/node/validate";
import { loadSettings } from "../src/settings";

setLang("ja");
const KEY = "sk-secret-test-key-123";
const sys = "SYSTEM";
const msgs: Msg[] = [{ role: "user", content: "hi" }];

// ---- リクエスト: キーは、ヘッダーにだけ (URL・本文には、入れない)
for (const p of ["claude", "openai", "gemini"] as const) {
  const r = chatRequest(p, "m-1", KEY, sys, msgs);
  assert.ok(!r.url.includes(KEY) && !(r.body ?? "").includes(KEY), `${p}: キーが、URL・本文に入っていない`);
  assert.ok(Object.values(r.headers).some((v) => v.includes(KEY)), `${p}: キーは、ヘッダーに入る`);
  const m = modelsRequest(p, KEY);
  assert.ok(!m.url.includes(KEY), `${p}: モデル一覧も、URL にキーを入れない`);
  assert.ok(r.url.startsWith({ claude: "https://api.anthropic.com/", openai: "https://api.openai.com/", gemini: "https://generativelanguage.googleapis.com/" }[p]), `${p}: 送り先は、その AI の API だけ`);
}
const claude = JSON.parse(chatRequest("claude", "m", KEY, sys, msgs).body!);
assert.equal(claude.system[0].text, sys);
assert.deepEqual(claude.system[0].cache_control, { type: "ephemeral" });
assert.deepEqual(claude.messages, msgs);
const openai = JSON.parse(chatRequest("openai", "m", KEY, sys, msgs).body!);
assert.deepEqual(openai.messages[0], { role: "system", content: sys });
const gem = JSON.parse(chatRequest("gemini", "m", KEY, sys, [...msgs, { role: "assistant", content: "ok" }]).body!);
assert.equal(gem.systemInstruction.parts[0].text, sys);
assert.deepEqual(gem.contents.map((c: { role: string }) => c.role), ["user", "model"], "Gemini は、assistant を model と呼ぶ");

// ---- 答えの読み方
assert.equal(chatText("claude", { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }), "ab");
assert.equal(chatText("openai", { choices: [{ message: { content: "x" } }] }), "x");
assert.equal(chatText("gemini", { candidates: [{ content: { parts: [{ text: "y" }] } }] }), "y");
assert.throws(() => chatText("openai", { choices: [] }), /empty/);
assert.deepEqual(modelIds("claude", { data: [{ id: "b" }, { id: "a" }] }), ["a", "b"]);
assert.deepEqual(modelIds("gemini", { models: [{ name: "models/g1", supportedGenerationMethods: ["generateContent"] }, { name: "models/emb", supportedGenerationMethods: ["embedContent"] }] }), ["g1"]);
assert.deepEqual(modelIds("openai", { data: [{ id: "gpt-5" }, { id: "text-embedding-3" }, { id: "whisper-1" }, { id: "o3" }, { id: "dall-e-3" }] }), ["gpt-5", "o3"]);

// ---- 設定: キーの値は、設定に持たない (名前だけ)
const s = loadSettings({ language: "ja", ai: { provider: "gemini", keyIds: { gemini: "my-gemini" }, models: { gemini: "g1" }, apiKey: KEY, keys: { claude: KEY } } });
assert.equal(s.ai.provider, "gemini");
assert.equal(s.ai.keyIds.gemini, "my-gemini");
assert.equal(s.ai.models.claude.length > 0, true, "モデルの初期値");
assert.ok(!JSON.stringify(s).includes(KEY), "設定を保存しても、キーの値は、入らない");
assert.equal(loadSettings(null).ai.provider, "claude");

// ---- 答えのブロックの取り出し・読み取り (mtg-node。古い node も、読める)
const answer = "短い説明です。\n\n```mtg-node\nkind: static\ntiming: replace-draw\nsteps:\n  draw(amount=2)\n```\n\n未対応: なし";
const blk = extractNodeBlock(answer)!;
assert.ok(blk.note.includes("短い説明") && blk.note.includes("未対応"));
assert.deepEqual(parseAbility(blk.body), { name: "", kind: "static", timing: "replace-draw", steps: [{ node: false, id: "draw", args: { amount: "2" } }] });
assert.equal(extractNodeBlock("ブロックが無い"), undefined);
assert.equal(extractNodeBlock("```node\nkind: static\n```")?.body, "kind: static\n", "古い node も、読める");
assert.ok(abilityBlock(EXAMPLES[0].node, true).startsWith("```mtg-node\n"), "書くときは、mtg-node");

// ---- 例: すべて、検証を通る。ブロックに書いて、読むと、元に戻る (id で書く)
const hasCard = (n: string, f?: string) => ["Elemental Token (1-1 R)", "Elk Token (3-3 G)"].includes(n) && f === "token";
for (const e of EXAMPLES) {
  assert.deepEqual(validate(e.node, () => undefined, hasCard), [], e.card);
  const { name: _n, source: _s, ...rest } = parseAbility(abilityBlock(e.node, true).split("\n").slice(1, -1).join("\n")); // name/source を除いた中身
  const { name: _n2, source: _s2, ...want } = e.node;
  assert.deepEqual(rest, want, e.card);
}
assert.ok(abilityBlock(EXAMPLES[4].node, true).includes("timing: replace-draw"), "id で書く");

// ---- 手引き: docs/ai-guide.md が、定義・例と、そろっている (ずれたら、npm run guide)
const guideMd = readFileSync("docs/ai-guide.md", "utf8");
assert.equal(renderGuide(guideMd), guideMd, "docs/ai-guide.md が古い。npm run guide で、更新する");
for (const must of ["modifyPT", "createToken", "eachObject", "replace-draw", "alternative-cost", "loyalty", "https://api.academyruins.com/cr/", "https://magic.wizards.com/en/rules", "ノードを組み終えたら、`src/ai/examples.ts` に追記"]) assert.ok(guideMd.includes(must), `手引きに ${must} がある`);

// ---- AI に組ませる流れ: 答えを検証し、問題があれば、伝えて、書き直させる
const card = { name: "Thought Reflection", type: "enchantment", text: "If you would draw a card, draw two cards instead.", abilities: [] as NodeData[] };
const ability: NodeData = { name: "If you would draw a card, draw two cards instead.", source: "If you would draw a card, draw two cards instead.", kind: "static", timing: "always", steps: [] };
const fakeChat = (answers: string[]) => {
  const sent: string[] = [];
  const http: Http = async (req) => {
    sent.push(req.body ?? "");
    return { status: 200, json: { content: [{ type: "text", text: answers[Math.min(sent.length - 1, answers.length - 1)] }] } };
  };
  return { http, sent };
};
const base = { provider: "claude" as const, model: "m", key: KEY, guide: "GUIDE", card, ability, tokenNames: [], hasCard };
{
  const { http, sent } = fakeChat([answer]);
  const r = await composeAbility({ ...base, http });
  assert.equal(r.tries, 1);
  assert.deepEqual(r.node, { ...ability, kind: "static", timing: "replace-draw", steps: [{ node: false, id: "draw", args: { amount: "2" } }] }, "名前・原文は、そのまま。中身が、組まれる");
  assert.ok(sent[0].includes("GUIDE") && sent[0].includes("組む行"), "手引きと、組む行を送る");
  assert.ok(!sent[0].includes(KEY), "本文に、キーは入らない");
}
{
  // 1 回目: 定義にない動作 → 問題を伝えて、2 回目で直る
  const bad = "```node\nkind: static\ntiming: replace-draw\nsteps:\n  drawTwice()\n```";
  const { http, sent } = fakeChat([bad, answer]);
  const r = await composeAbility({ ...base, http });
  assert.equal(r.tries, 2);
  assert.ok(r.node);
  const second = JSON.parse(sent[1]);
  assert.equal(second.messages.length, 3, "1 回目の答えと、問題の伝言が、足される");
  assert.ok(second.messages[2].content.includes("検証で、次の問題が出ました") && second.messages[2].content.includes("drawTwice"), "問題を伝える");
}
{
  // 3 回とも通らない → 能力は、組まれない。問題が返る
  const { http } = fakeChat(["ブロックなし"]);
  const r = await composeAbility({ ...base, http, maxTries: 2 });
  assert.equal(r.node, undefined);
  assert.equal(r.tries, 2);
  assert.ok(r.problems.length > 0);
}
{
  // HTTP のエラー
  await assert.rejects(composeAbility({ ...base, http: async () => ({ status: 401, json: { error: { message: "invalid x-api-key" } } }) }), /HTTP 401 invalid x-api-key/);
}
assert.ok(userPrompt({ card, ability, tokenNames: ["Elemental Token (1-1 R)"] }).includes("Elemental Token (1-1 R)"));
assert.ok(userPrompt({ card, ability, tokenNames: [] }).includes("登録済みのトークン: なし"));

// ---- コードブロックの色分け (mtg-node)
const cls = (line: string) => tokenize(line).map((t) => [line.slice(t.from, t.to), t.cls]);
assert.deepEqual(cls("kind: triggered"), [["kind", "mtg-key"], ["triggered", "mtg-value"]]);
assert.deepEqual(cls("loyalty: -2"), [["loyalty", "mtg-key"], ["-2", "mtg-num"]]);
assert.deepEqual(cls("  modifyPT(power=2, toughness=2, duration=until-eot)"), [
  ["modifyPT", "mtg-fn"], ["power", "mtg-param"], ["2", "mtg-value"], ["toughness", "mtg-param"], ["2", "mtg-value"], ["duration", "mtg-param"], ["until-eot", "mtg-value"],
]);
assert.deepEqual(cls("  addMana(mana={C}{C}{C})"), [["addMana", "mtg-fn"], ["mana", "mtg-param"], ["{C}", "mtg-mana"], ["{C}", "mtg-mana"], ["{C}", "mtg-mana"]]);
assert.deepEqual(cls("name: {T}: Add {G}."), [["name", "mtg-key"], ["{T}: Add {G}.", "mtg-text"]], "名前・原文の行は、中の記号に、色を付けない");
assert.deepEqual(cls("target: eachObject(controller=you, type=instant|sorcery)").map((x) => x[1]).slice(0, 2), ["mtg-key", "mtg-fn"]);
assert.deepEqual(cls("  [[Other]]"), [["[[Other]]", "mtg-link"]]);
assert.deepEqual(cls("種類: 誘発型"), [["種類", "mtg-key"], ["誘発型", "mtg-value"]]);
assert.ok(FENCE_OPEN.test("```mtg-node") && !FENCE_OPEN.test("```node"), "古い node は、色分けしない");
const g = prismGrammar();
assert.ok(Object.keys(g).length >= 9 && Object.values(g).every((x) => x.alias.startsWith("mtg-") && x.pattern instanceof RegExp));

// ---- 点検: 組んであるのに、原文の一部が、組めていないものを、見つける (抜けの疑い・部品が足りない)
{
  const hasTok = (n: string, f?: string) => ["Elemental Token (1-1 R)", "Elk Token (3-3 G)"].includes(n) && f === "token";
  // 正しく組んだ例は、問題も、抜けの疑いも、出ない (言い回しの規則が、誤って疑わない)
  for (const e of EXAMPLES) {
    const au = auditAbility({ name: "x", abilities: [e.node] }, e.node, hasTok);
    assert.deepEqual(au, { problems: [], gaps: [] }, e.card);
  }
  // AI が組んだ Black Lotus (コストの生け贄を、手順に。マナを加える効果が無い): 抜けが、見つかる
  const lotus = { name: "{T}, Sacrifice this artifact: Add three mana of any one color.", source: "{T}, Sacrifice this artifact: Add three mana of any one color.", kind: "activated", timing: "anytime", target: "self", cost: [{ id: "tap-self", args: {} }], steps: [{ node: false as const, id: "sacrifice", args: {} }] } satisfies NodeData;
  const gaps = auditAbility({ name: "Black Lotus", abilities: [lotus] }, lotus, hasTok).gaps.join(" | ");
  assert.match(gaps, /Sacrifice.*sacrifice-cost/, "コストの生け贄が、コストに無い");
  assert.match(gaps, /Add three mana.*add-mana/, "マナを加える効果が、無い");
  // 部品が足りない (定義に、動作が無い): Destroy
  // 対象が 2 つの原文 (… and target …) で、もう1つの対象が無い: 抜けの疑い
  const exch = EXAMPLES.find((e) => e.card.startsWith("Oko, Thief of Crowns −5"))!.node;
  assert.ok(auditAbility({ name: "x", abilities: [exch] }, { ...exch, alsoTargets: undefined }, hasTok).gaps.some((g) => g.includes("対象が 2 つ")));
  assert.ok(auditAbility({ name: "x", abilities: [exch] }, { ...exch, alsoTargets: undefined, steps: [] }, hasTok).gaps.some((g) => /exchange.control/i.test(g)), "コントロールの交換が無い");
  const destroy = { name: "Destroy target creature.", source: "Destroy target creature.", kind: "spell", timing: "resolves", steps: [] } satisfies NodeData;
  const g2 = auditAbility({ name: "Doom Blade", abilities: [destroy] }, destroy, hasTok);
  assert.ok(g2.gaps.some((g) => g.includes("部品が足りない") && g.includes("destroy")));
  assert.ok(g2.gaps.some((g) => g.includes("target があるのに")), "対象が、組まれていない");
  assert.ok(g2.problems.some((p) => p.includes("手順が空")), "組みかけの問題 (検証)");
  // 構造: 「コスト: 効果」なのに、起動型でない / 忠誠度のコスト無し
  const notAct = { ...lotus, kind: "static", timing: "always", cost: undefined, steps: [{ node: false as const, id: "add-mana-any-color", args: { amount: "3" } }] } satisfies NodeData;
  assert.ok(auditAbility({ name: "x", abilities: [notAct] }, notAct, hasTok).gaps.some((g) => g.includes("起動型ではない")));
  const noLoy = { name: "-2: Draw a card.", source: "-2: Draw a card.", kind: "activated", timing: "sorcery-speed", steps: [{ node: false as const, id: "draw", args: { amount: "1" } }] } satisfies NodeData;
  assert.ok(auditAbility({ name: "x", abilities: [noLoy] }, noLoy, hasTok).gaps.some((g) => g.includes("忠誠度のコスト")));
  // カード単位: ルールなし / 問題あり / 抜けの疑い / 完成
  const done = auditCard({ name: "Force", abilities: EXAMPLES.filter((e) => e.card.startsWith("Force of Will")).map((e) => e.node) }, hasTok);
  assert.equal(done.needsReview, false);
  assert.equal(auditCard({ name: "Empty", text: "Draw a card.", abilities: [] }, hasTok).noRules, true);
  assert.equal(auditCard({ name: "Empty", text: "Draw a card.", abilities: [] }, hasTok).needsReview, true);
  assert.equal(auditCard({ name: "Vanilla Token", token: true, abilities: [] }, hasTok).needsReview, false, "原文の無いカード (バニラ・トークン) は、組むものが無い");
  const bad = auditCard({ name: "Black Lotus", abilities: [lotus] }, hasTok);
  assert.equal(bad.needsReview, true);
  assert.ok(bad.gapCount >= 2 && bad.problemCount === 0, "検証は通るが、抜けの疑いがある、というカード");
  assert.equal(auditCard({ name: "Doom Blade", abilities: [destroy] }, hasTok).problemCount > 0, true);
}

console.log("ai ok");
