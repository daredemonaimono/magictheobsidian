import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { JevAsk, compileRule } from "../src/battle/compileRule";
import { JevQuestion } from "../src/battle/jev";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";

resetRegistry();
registerBuiltinNodes();

// Jev は、仮の応答 (本物には、つながない)。noul は 0.95、choice は、最初の選択肢を 0.95 の自信で、選ぶ
const fake = (overrides: Record<string, unknown> = {}): { ask: JevAsk; seen: Record<string, JevQuestion>[] } => {
  const seen: Record<string, JevQuestion>[] = [];
  const ask: JevAsk = async (_state, questions) => {
    seen.push(questions);
    const answers: Record<string, any> = {};
    for (const [k, q] of Object.entries(questions)) {
      if (k in overrides) answers[k] = overrides[k];
      else if (q.type === "noul") answers[k] = { type: "noul", noul: k.startsWith("x") ? 0.05 : 0.95 }; // v = その動作か (高い) / x = ほかがあるか (低い)
      else {
        const first = Object.keys(q.criteria)[0];
        answers[k] = { type: "choice", choice: first, confidence: 0.95, probabilities: { [first]: 0.95 } };
      }
    }
    return { answers, input: 200, output: 0, ms: 80 };
  };
  return { ask, seen };
};

(async () => {
  // ---- Ancestral Recall: 動作 draw / 数 3 / 対象 player。Jev に聞くのは、確かめる 1 問だけ
  {
    const f = fake();
    const r = await compileRule({ card: "Ancestral Recall", oracle: "Instant\n\nTarget player draws three cards.", ask: f.ask });
    assert.ok(r.md, r.reason);
    assert.ok(r.md!.includes("- target as=t zone=player kind=player\n- draw player=target target=$t count=3\n"));
    assert.deepEqual(Object.keys(f.seen[0]), ["v0", "x0"], "決まるものは、コードが決める。Jev には、確かめる 2 問 (その動作か / ほかがあるか) だけ");
    assert.equal(r.jev!.ms, 80);
  }
  // 打ち消し (unlessPay)・ダメージ・ライフ・追加のターン
  {
    const f = fake();
    const c = await compileRule({ card: "Mana Leak", oracle: "Instant\n\nCounter target spell unless its controller pays {3}.", ask: f.ask });
    assert.ok(c.md!.includes("- target as=t zone=stack kind=spell\n- counter target=$t unlessPay=3\n"), c.reason);
    const d = await compileRule({ card: "Lightning Bolt", oracle: "Instant\n\nLightning Bolt deals 3 damage to any target.", ask: f.ask });
    assert.ok(d.md!.includes("- target as=t zone=any kind=any\n- damage target=$t amount=3\n"), d.reason);
    const l = await compileRule({ card: "Healing Salve", oracle: "Instant\n\nYou gain 3 life.", ask: f.ask });
    assert.ok(l.md!.includes("- gainLife player=you amount=3\n"), l.reason);
    const t = await compileRule({ card: "Time Walk", oracle: "Sorcery\n\nTake an extra turn after this one.", ask: f.ask });
    assert.ok(t.md!.includes("- extraTurn\n"), t.reason);
    const e = await compileRule({ card: "Swords", oracle: "Instant\n\nExile target creature. Its controller gains life equal to its power.", ask: f.ask });
    assert.ok(!e.md && e.reason, "『その controller が』は、型が無い → LLM に回す");
  }
  // 数量が 2 つ出る節は、Jev に、選択式で聞く (どれが枚数か)。文は、選択式の質問を試すための、作り物
  {
    const f = fake({ n0: { type: "choice", choice: "n1", confidence: 0.9, probabilities: { n1: 0.9 } } });
    const r = await compileRule({ card: "Odd", oracle: "Sorcery\n\nYou draw two cards, 3 total.", ask: f.ask });
    assert.ok(r.md, r.reason);
    assert.ok(r.md!.includes("count=3"), "Jev が選んだ 2 番目の数");
    assert.deepEqual(Object.keys(f.seen[0]).sort(), ["n0", "v0", "x0"]);
  }
  // 自信が足りない・Jev の失敗・呪文能力でない・型が無い → md を返さず、理由 (LLM に回す)
  {
    const low = await compileRule({ card: "Ancestral Recall", oracle: "Target player draws three cards.", ask: fake({ v0: { type: "noul", noul: 0.4 } }).ask });
    assert.ok(!low.md && /確かさが足りない/.test(low.reason!));
    const other = await compileRule({ card: "Ancestral Recall", oracle: "Target player draws three cards.", ask: fake({ x0: { type: "noul", noul: 0.95 } }).ask });
    assert.ok(!other.md && /ほかの動作・条件があると見ている/.test(other.reason!), "強く「ほかの動作・条件がある」と答えたら、組まない");
    const unsure = await compileRule({ card: "Ancestral Recall", oracle: "Target player draws three cards.", ask: fake({ x0: { type: "noul", noul: 0.59 } }).ask });
    assert.ok(unsure.md, "実機の返事 (v=0.99・x=0.59) では、組める");
    assert.ok(other.answers, "診断用に、Jev の返事を返す");
    const boom = await compileRule({ card: "X", oracle: "Draw three cards.", ask: async () => { throw new Error("Jev の API キーが無効"); } });
    assert.ok(!boom.md && /Jev が使えない/.test(boom.reason!));
    const kw = await compileRule({ card: "Bear", oracle: "Flying", ask: fake().ask });
    assert.ok(!kw.md && /呪文能力だけ/.test(kw.reason!));
    const none = await compileRule({ card: "Weird", oracle: "Instant\n\nTarget player's life total becomes 1.", ask: fake().ask });
    assert.ok(!none.md);
  }

  // ---- 本物のカードで: Cards の英語テキスト → 組んだルールが、今の Rules (LLM が作ったもの) と、同じ行か
  const VAULT = "/Users/daredemonai/Documents/Westeros/MagicTheObsidian";
  const oracleOf = (name: string): string | undefined => {
    try {
      return readFileSync(`${VAULT}/Cards/${name}.md`, "utf-8").replace(/^---[\s\S]*?\n---\n/, "").replace(/!\[[^\]]*\]\(.*?\)\n*/g, "").split(/\n## Text \(|\n\[Scryfall\]|\n## Printings/)[0].trim();
    } catch {
      return undefined;
    }
  };
  const bodyOf = (md: string) => md.split("\n## 未対応")[0].split("\n").filter((l) => l.startsWith("- ")).sort();
  let tried = 0;
  let built = 0;
  let same = 0;
  const diffs: string[] = [];
  for (const file of readdirSync(`${VAULT}/Rules`).filter((x) => x.endsWith(".md") && !x.startsWith("_"))) {
    const name = file.replace(/\.md$/, "");
    const oracle = oracleOf(name);
    if (!oracle) continue;
    tried++;
    const r = await compileRule({ card: name, oracle, ask: fake().ask });
    if (!r.md) continue;
    built++;
    const mine = bodyOf(r.md);
    const theirs = bodyOf(readFileSync(`${VAULT}/Rules/${file}`, "utf-8"));
    if (JSON.stringify(mine) === JSON.stringify(theirs)) same++;
    else diffs.push(`${name}:\n   組んだ: ${mine.join(" ; ")}\n   今の  : ${theirs.join(" ; ")}`);
  }
  console.log(`compile: Rules のある ${tried} 枚のうち、コードと Jev で組めた ${built} 枚、今の Rules と同じ行 ${same} 枚`);
  if (process.env.SPLIT_MISSES) console.log(diffs.join("\n"));
  assert.ok(built >= 3, "組めるカードが、少なすぎる");
  assert.ok(same >= built * 0.5, "組めたものの半分以上は、今の Rules と同じ行のはず");
  console.log("compile ok");
})();
