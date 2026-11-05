import assert from "node:assert";
import { ClaudeError, Http } from "../src/battle/claude";
import { askGemini, askOpenAI } from "../src/battle/providers";

const rec = (status: number, json: unknown) => {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  const http: Http = async (url, headers, body) => (calls.push({ url, headers, body: JSON.parse(body) }), { status, json });
  return { http, calls };
};

// OpenAI: 要求の形・返事の読み取り・トークン数
{
  const { http, calls } = rec(200, { choices: [{ message: { content: '{"choice":1}' } }], usage: { prompt_tokens: 120, completion_tokens: 30 } });
  const r = await askOpenAI({ apiKey: "sk-test", model: "m1", system: "S", user: "U", http });
  assert.deepEqual(r, { text: '{"choice":1}', input: 120, output: 30 });
  assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(calls[0].headers.authorization, "Bearer sk-test");
  assert.deepEqual(calls[0].body, { model: "m1", messages: [{ role: "system", content: "S" }, { role: "user", content: "U" }] });
}
// 互換 API (自分のパソコンの AI): URL を差し替え。キー無しなら、認証ヘッダーを付けない。末尾の / は無視
{
  const { http, calls } = rec(200, { choices: [{ message: { content: "ok" } }] });
  const r = await askOpenAI({ apiKey: "", baseUrl: "http://localhost:11434/v1/", model: "llama", system: "S", user: "U", http });
  assert.equal(r.text, "ok");
  assert.equal(r.input, undefined);
  assert.equal(calls[0].url, "http://localhost:11434/v1/chat/completions");
  assert.equal("authorization" in calls[0].headers, false);
}
// Gemini: キーはヘッダー (URL に入れない)・システム指示・思考のぶんも出力に数える・思考の文章は返事に入れない
{
  const { http, calls } = rec(200, { candidates: [{ content: { parts: [{ text: "考え", thought: true }, { text: '{"choice":2}' }] } }], usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 20, thoughtsTokenCount: 80 } });
  const r = await askGemini({ apiKey: "g-key", model: "gemini-x", system: "S", user: "U", http });
  assert.deepEqual(r, { text: '{"choice":2}', input: 200, output: 100 });
  assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent");
  assert.equal(calls[0].url.includes("g-key"), false);
  assert.equal(calls[0].headers["x-goog-api-key"], "g-key");
  assert.deepEqual(calls[0].body, { systemInstruction: { parts: [{ text: "S" }] }, contents: [{ role: "user", parts: [{ text: "U" }] }] });
}
// エラー: 無効なキー・レート制限・サーバー・空の返事・拒否。キーはメッセージに出さない
for (const [status, msg] of [[401, "APIキーが無効"], [429, "レート制限"], [503, "混雑"]] as const) {
  await assert.rejects(askOpenAI({ apiKey: "k", model: "m", system: "S", user: "U", http: rec(status, {}).http }), (e: Error) => e instanceof ClaudeError && e.message.includes(msg));
  await assert.rejects(askGemini({ apiKey: "k", model: "m", system: "S", user: "U", http: rec(status, {}).http }), (e: Error) => e instanceof ClaudeError && e.message.includes(msg));
}
await assert.rejects(askOpenAI({ apiKey: "sk-secret", model: "m", system: "S", user: "U", http: rec(400, { error: { message: "bad sk-secret" } }).http }), (e: Error) => !e.message.includes("sk-secret") && e.message.includes("***"));
await assert.rejects(askOpenAI({ apiKey: "k", model: "m", system: "S", user: "U", http: rec(200, { choices: [{ message: { content: "" } }] }).http }), /空の返事/);
await assert.rejects(askGemini({ apiKey: "k", model: "m", system: "S", user: "U", http: rec(200, { promptFeedback: { blockReason: "SAFETY" } }).http }), /拒否/);
console.log("providers ok");
