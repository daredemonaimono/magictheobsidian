import assert from "node:assert";
import { DEFAULT_AI, aiLabel, aiReady, migrateAi, runAi } from "../src/battle/aiConfig";
import { Http } from "../src/battle/claude";

// 昔の設定 (場面ごとの区別が無かった) から、移す: キー・モデルが、残る。メモの下書きは、対戦の相手と同じだった
const legacy = { claudeKeySecret: "k-claude", claudeModel: "claude-opus-5-5", battleModel: "claude-haiku-5-5", battleProvider: "openai", openaiKeySecret: "k-openai", openaiModel: "gpt-x", openaiBaseUrl: "http://localhost:11434/v1", geminiKeySecret: "k-gemini", geminiModel: "gem-x" };
const m = migrateAi(legacy);
assert.deepEqual(m.keys, { claude: "k-claude", openai: "k-openai", gemini: "k-gemini", jev: "" }, "昔の設定には、Jev のキーは無い (空)");
assert.equal(m.openaiBaseUrl, "http://localhost:11434/v1");
assert.equal(m.scenes.battle.provider, "openai");
assert.deepEqual(m.scenes.battle.models, { claude: "claude-haiku-5-5", openai: "gpt-x", gemini: "gem-x", jev: "jev-latest" }, "切り替えても、各種類のモデルが残る");
assert.equal(m.scenes.memo.provider, "openai");
assert.equal(m.scenes.rules.provider, "claude");
assert.equal(m.scenes.rules.models.claude, "claude-opus-5-5");
// 何も無い設定: 初期値
assert.deepEqual(migrateAi({}), DEFAULT_AI);
assert.deepEqual(migrateAi(undefined), DEFAULT_AI);
// 新しい形は、そのまま (足りない・壊れた部分は、初期値)
const n = migrateAi({ ai: { keys: { claude: "a" }, scenes: { battle: { provider: "gemini", models: { gemini: "g1" } }, rules: { provider: "nope" } } } });
assert.equal(n.keys.claude, "a");
assert.equal(n.keys.openai, "");
assert.equal(n.scenes.battle.provider, "gemini");
assert.equal(n.scenes.battle.models.gemini, "g1");
assert.equal(n.scenes.battle.models.claude, "claude-sonnet-5-5");
assert.equal(n.scenes.rules.provider, "claude", "知らない種類は、初期値");
assert.deepEqual(migrateAi({ ai: JSON.parse(JSON.stringify(n)) }), n, "保存して読み戻すと、同じ");
// 呼べるか
const sec = (names: string[]) => (name: string) => (names.includes(name) ? "secret-" + name : null);
assert.equal(aiReady(m, "battle", sec([])), true, "互換 API の URL を変えていれば、キー無しでよい (OpenAI の場面)");
assert.equal(aiReady(m, "rules", sec([])), false);
assert.equal(aiReady(m, "rules", sec(["k-claude"])), true);
assert.equal(aiLabel(m, "battle"), "openai:gpt-x");
// 場面ごとに、別の AI が呼ばれる (種類を切り替えても、他の場面と、キーは残る)
const calls: string[] = [];
const http: Http = async (url, headers, body) => {
  calls.push(url);
  return url.includes("anthropic") ? { status: 200, json: { content: [{ type: "text", text: "claude返事" }], usage: { input_tokens: 5, output_tokens: 2 } } } : url.includes("generativelanguage") ? { status: 200, json: { candidates: [{ content: { parts: [{ text: "gemini返事" }] } }] } } : { status: 200, json: { choices: [{ message: { content: "openai返事" } }] } };
};
const ai = migrateAi({ ai: { keys: { claude: "kc", openai: "ko", gemini: "kg" }, scenes: { battle: { provider: "claude" }, rules: { provider: "gemini" }, memo: { provider: "openai" } } } });
const msgs = [{ role: "user" as const, content: "q" }, { role: "assistant" as const, content: "a" }, { role: "user" as const, content: "q2" }];
assert.deepEqual(await runAi({ ai, scene: "battle", secret: sec(["kc", "ko", "kg"]), http, system: "S", messages: msgs }), { text: "claude返事", input: 5, output: 2 });
assert.equal((await runAi({ ai, scene: "rules", secret: sec(["kc", "ko", "kg"]), http, system: "S", messages: msgs })).text, "gemini返事");
assert.equal((await runAi({ ai, scene: "memo", secret: sec(["kc", "ko", "kg"]), http, system: "S", messages: msgs })).text, "openai返事");
assert.ok(calls[0].includes("anthropic") && calls[1].includes("generativelanguage") && calls[2].includes("openai.com"));
await assert.rejects(runAi({ ai, scene: "rules", secret: sec([]), http, system: "S", messages: msgs }), /Gemini の API キーが未設定/);
console.log("aiconfig ok");
