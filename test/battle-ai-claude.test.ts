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
assert.equal(seen!.body.system, "sys");
assert.deepEqual(seen!.body.messages, [{ role: "user", content: "hi" }]);
assert.ok(!("temperature" in seen!.body) && !("thinking" in seen!.body), "サンプリング引数と thinking は送らない");

// エラー (Review Focus 1)
await fails(reply(401, { error: { message: "invalid x-api-key" } }), "APIキーが無効");
await fails(reply(429, {}), "レート制限");
await fails(reply(529, {}), "混雑");
await fails(reply(500, {}), "混雑");
await fails(reply(400, { error: { message: `bad request ${KEY}` } }), "HTTP 400");
await fails(reply(200, { stop_reason: "refusal", content: [] }), "拒否");
await fails(reply(200, { stop_reason: "end_turn", content: [] }), "空の返事");
await fails(reply(200, { stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }] }), "空の返事");
