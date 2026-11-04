import assert from "node:assert";
import { BuildError, buildRule } from "../src/battle/build";
import { ClaudeError, Msg } from "../src/battle/claude";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { SAMPLE_RULES } from "../src/battle/samples";

resetRegistry();
registerBuiltinNodes();

const fence = (md: string) => "説明です\n```md\n" + md + "```\n";
const seq = (...replies: string[]) => {
  const calls: Msg[][] = [];
  return { calls, ask: async (_s: string, m: Msg[]) => (calls.push(m.map((x) => ({ ...x }))), replies[calls.length - 1] ?? replies[replies.length - 1]) };
};
const bad = SAMPLE_RULES["Negate"].replace("counter target=$t", "teleport who=me");

// 1回目で通る。md は囲みの中身そのまま
{
  const s = seq(fence(SAMPLE_RULES["Negate"]));
  const r = await buildRule({ card: "Negate", oracle: "Counter target noncreature spell.", ask: s.ask });
  assert.equal(r.attempts, 1);
  assert.equal(r.md, SAMPLE_RULES["Negate"]);
  assert.ok(s.calls[0][0].content.includes("Counter target noncreature spell."));
}

// 1回目が未知のノード → 問題を渡してやり直し、2回目で通る
{
  const s = seq(fence(bad), fence(SAMPLE_RULES["Negate"]));
  const r = await buildRule({ card: "Negate", oracle: "x", ask: s.ask });
  assert.equal(r.attempts, 2);
  const last = s.calls[1][s.calls[1].length - 1];
  assert.equal(last.role, "user");
  assert.ok(last.content.includes("未知のノード: teleport") && last.content.includes("行目"), last.content);
  assert.equal(s.calls[1][1].role, "assistant", "前の返事も渡す");
}

// 別のカード名を書いた (Review Focus 2) → 2回続けてだめなら BuildError。聞くのは2回だけ
{
  const s = seq(fence(SAMPLE_RULES["Essence Scatter"]));
  await assert.rejects(
    () => buildRule({ card: "Negate", oracle: "x", ask: s.ask }),
    (e) => e instanceof BuildError && e.problems.some((p) => p.includes("card:")) && e.problems.length > 0,
  );
  assert.equal(s.calls.length, 2);
}

// 囲みなしの返事、## 未対応つきの md も通る
{
  const note = SAMPLE_RULES["Negate"] + "\n## 未対応\n\n- 例\n";
  const r = await buildRule({ card: "Negate", oracle: "x", ask: seq(note).ask });
  assert.equal(r.attempts, 1);
  assert.equal(r.md.trim(), note.trim());
}

// 通信のエラーは、やり直さずにそのまま伝わる
{
  let n = 0;
  await assert.rejects(
    () => buildRule({ card: "Negate", oracle: "x", ask: async () => (n++, Promise.reject(new ClaudeError("APIキーが無効"))) }),
    (e) => e instanceof ClaudeError,
  );
  assert.equal(n, 1);
}
