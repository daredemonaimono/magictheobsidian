import assert from "node:assert";
import { ClaudeError, Http, askClaude } from "../src/battle/claude";

const KEY = "sk-ant-secret-key";
const reply = (status: number, json: unknown): Http => async () => ({ status, json });
const ask = (http: Http) => askClaude({ apiKey: KEY, model: "claude-opus-5-5", system: "sys", messages: [{ role: "user", content: "hi" }], http });
const fails = async (http: Http, includes: string) => {
  try {
    await ask(http);
  } catch (e) {
    assert.ok(e instanceof ClaudeError, "ClaudeError であること");
    assert.ok(e.message.includes(includes), e.message);
    assert.ok(!e.message.includes(KEY), "メッセージにキーを出さない");
    return;
  }
  assert.fail("エラーになるはず");
};

// 正常: text ブロックだけをつなぐ (thinking は読まない)。送るもの
let seen: { url: string; headers: Record<string, string>; body: any } | undefined;
const ok: Http = async (url, headers, body) => {
  seen = { url, headers, body: JSON.parse(body) };
  return { status: 200, json: { stop_reason: "end_turn", content: [{ type: "text", text: "A" }, { type: "thinking", thinking: "" }, { type: "text", text: "B" }] } };
};
assert.equal(await ask(ok), "AB");
assert.equal(seen!.url, "https://api.anthropic.com/v1/messages");
assert.equal(seen!.headers["x-api-key"], KEY);
assert.equal(seen!.headers["anthropic-version"], "2023-06-01");
assert.equal(seen!.headers["content-type"], "application/json");
assert.equal(seen!.body.model, "claude-opus-5-5");
assert.equal(seen!.body.max_tokens, 16000);
assert.deepEqual(seen!.body.system, [{ type: "text", text: "sys", cache_control: { type: "ephemeral" } }], "固定の system は、キャッシュする");
assert.deepEqual(seen!.body.messages, [{ role: "user", content: "hi" }]);
assert.ok(!("temperature" in seen!.body) && !("thinking" in seen!.body), "サンプリング引数と thinking は送らない");

// キャッシュの使用量: 読み込み・書き込みも、入力に数える (内訳も返す)
{
  let u: { input: number; output: number; cacheRead?: number; cacheWrite?: number } | undefined;
  const withUsage: Http = async () => ({ status: 200, json: { stop_reason: "end_turn", content: [{ type: "text", text: "A" }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2000, cache_creation_input_tokens: 300 } } });
  await askClaude({ apiKey: KEY, model: "m", system: "sys", messages: [{ role: "user", content: "hi" }], http: withUsage, onUsage: (x) => (u = x) });
  assert.deepEqual(u, { input: 2310, output: 5, cacheRead: 2000, cacheWrite: 300 });
}

// エラー (Review Focus 1)
await fails(reply(401, { error: { message: "invalid x-api-key" } }), "APIキーが無効");
await fails(reply(429, {}), "レート制限");
await fails(reply(529, {}), "混雑");
await fails(reply(500, {}), "混雑");
await fails(reply(400, { error: { message: `bad request ${KEY}` } }), "HTTP 400");
await fails(reply(200, { stop_reason: "refusal", content: [] }), "拒否");
await fails(reply(200, { stop_reason: "end_turn", content: [] }), "空の返事");
await fails(reply(200, { stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }] }), "空の返事");
