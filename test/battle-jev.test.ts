import assert from "node:assert";
import { DEFAULT_AI, JEV_SCENES, fallbackAi, migrateAi, providersFor } from "../src/battle/aiConfig";
import { ClaudeError, Http } from "../src/battle/claude";
import { JEV_URL, askJev, jevAct, jevAttack, jevBlock } from "../src/battle/jev";

// 通信は、仮の応答 (Http) で試す。本物の Jev には、つながない
const reply = (answers: Record<string, unknown>, usage = { input_tokens: 100, output_tokens: 10 }): Http => async () => ({ status: 200, json: { model: "jev-1", answers, usage } });
const base = { apiKey: "SECRET-KEY", model: "jev-latest" };

(async () => {
  // 送る内容: URL・認証・本文
  {
    let seen: { url: string; headers: Record<string, string>; body: any } | undefined;
    const http: Http = async (url, headers, body) => {
      seen = { url, headers, body: JSON.parse(body) };
      return { status: 200, json: { answers: { q: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 42, output_tokens: 0 } } };
    };
    const r = await askJev({ ...base, state: "S", questions: { q: { type: "noul", instructions: "?" } }, http });
    assert.equal(seen!.url, JEV_URL);
    assert.equal(seen!.headers.Authorization, "Bearer SECRET-KEY");
    assert.deepEqual(seen!.body, { model: "jev-latest", state: "S", questions: { q: { type: "noul", instructions: "?" } } });
    assert.equal(r.input, 42);
    assert.equal(r.answers.q.noul, 0.9);
  }
  // 失敗: キーが無効・混雑 (やり直す)・残高不足。キーは、メッセージに出ない
  {
    await assert.rejects(askJev({ ...base, state: "S", questions: {}, http: async () => ({ status: 401, json: {} }) }), (e) => e instanceof ClaudeError && /キーが無効/.test(e.message));
    await assert.rejects(askJev({ ...base, state: "S", questions: {}, http: async () => ({ status: 402, json: {} }) }), /残高/);
    let n = 0;
    const r = await askJev({ ...base, state: "S", questions: {}, wait: async () => {}, http: async () => (++n < 3 ? { status: 429, json: {} } : { status: 200, json: { answers: {}, usage: { input_tokens: 1, output_tokens: 0 } } }) });
    assert.equal(n, 3, "429 は、2回まで、やり直す");
    assert.deepEqual(r.answers, {});
    await assert.rejects(askJev({ ...base, state: "S", questions: {}, wait: async () => {}, http: async () => ({ status: 429, json: {} }) }), /レート制限/, "3回目も 429 なら、諦める");
    await assert.rejects(askJev({ ...base, state: "S", questions: {}, http: async () => ({ status: 500, json: { error: "oops SECRET-KEY" } }) }), (e) => e instanceof ClaudeError && !e.message.includes("SECRET-KEY"), "キーは、メッセージに出さない");
  }

  // ---- 対戦: 行動 (「何もしない」は、最後に置く。最初の選択肢に偏るため)
  {
    let sent: any;
    const http: Http = async (_u, _h, body) => ((sent = JSON.parse(body)), { status: 200, json: { answers: { action: { type: "choice", choice: "o2", confidence: 0.9, probabilities: { o2: 0.9, o0: 0.1 } } }, usage: { input_tokens: 500, output_tokens: 0 } } });
    const d = await jevAct({ ...base, http, state: "盤面", options: [{ id: 0, label: "何もしない" }, { id: 1, label: "唱える: A" }, { id: 2, label: "唱える: B" }] });
    assert.deepEqual(Object.keys(sent.questions.action.criteria), ["o1", "o2", "o0"], "何もしない (0 番) は、最後");
    assert.deepEqual(d.reply, { choice: 2 });
    assert.equal(d.confidence, 0.9);
    await assert.rejects(jevAct({ ...base, http: reply({}), state: "s", options: [] }), /行動が無い/);
  }
  // 攻撃: クリーチャーごとに はい/いいえ。0.5 以上が攻撃。自信は、いちばん決めかねているもの
  {
    const d = await jevAttack({ ...base, http: reply({ a0: { type: "noul", noul: 0.95 }, a1: { type: "noul", noul: 0.4 }, a2: { type: "noul", noul: 0.1 } }), state: "s", attackers: [{ id: "x", label: "X 2/2" }, { id: "y", label: "Y 1/1" }, { id: "z", label: "Z 3/3" }] });
    assert.deepEqual(d.reply, { attackers: ["x"] });
    assert.ok(Math.abs(d.confidence - 0.6) < 1e-9, "自信 = 0.4 のほうの 0.6 (決めかねている)");
    await assert.rejects(jevAttack({ ...base, http: reply({ a0: { type: "noul", noul: 0.9 } }), state: "s", attackers: [{ id: "x", label: "X" }, { id: "y", label: "Y" }] }), /足りない/, "答えが欠けたら、使わない");
  }
  // ブロック: 攻撃ごとに、どれでブロックするか。同じブロッカーが重なったら、確率の高いほう
  {
    const ans = {
      k0: { type: "choice", choice: "b0", confidence: 0.8, probabilities: { b0: 0.8, none: 0.2 } },
      k1: { type: "choice", choice: "b0", confidence: 0.9, probabilities: { b0: 0.9, none: 0.1 } },
      k2: { type: "choice", choice: "none", confidence: 0.7, probabilities: { none: 0.7, b0: 0.3 } },
    };
    const d = await jevBlock({ ...base, http: reply(ans), state: "s", attackers: [{ id: "A", label: "A" }, { id: "B", label: "B" }, { id: "C", label: "C" }], blockers: [{ id: "g", label: "G" }] });
    assert.deepEqual(d.reply, { blocks: [{ blocker: "g", attacker: "B" }] }, "G は 1 体だけをブロック (確率の高い B)");
    assert.equal(d.confidence, 0.7);
  }

  // ---- 設定: Jev は、選ぶ場面だけ。聞き直す AI
  {
    assert.deepEqual(JEV_SCENES, ["battle"]);
    assert.ok(providersFor("battle").some(([id]) => id === "jev") && !providersFor("rules").some(([id]) => id === "jev") && !providersFor("nodes").some(([id]) => id === "jev") && !providersFor("memo").some(([id]) => id === "jev"), "ルール・メモ (文章を作る) では、Jev を選べない");
    const m = migrateAi({ ai: { keys: { jev: "kj" }, scenes: { rules: { provider: "jev" }, battle: { provider: "jev", models: { jev: "jev-x" } } }, jev: { confidence: 0.8, recall: 0.1, fallback: "none", compile: true } } });
    assert.equal(m.keys.jev, "kj");
    assert.equal(m.scenes.battle.provider, "jev");
    assert.equal(m.scenes.battle.models.jev, "jev-x");
    assert.equal(m.scenes.rules.provider, "claude", "文章を作る場面に Jev が書いてあっても、無視する");
    assert.deepEqual(m.jev, { confidence: 0.8, fallback: "none" });
    assert.deepEqual(migrateAi({ ai: { jev: { confidence: 5, fallback: "jev" } } }).jev, DEFAULT_AI.jev, "範囲外・知らない値は、初期値");
    const secret = (n: string) => (n === "kc" ? "KEY" : null);
    const ai = migrateAi({ ai: { keys: { claude: "kc" }, scenes: { battle: { provider: "jev" } } } });
    assert.equal(fallbackAi(ai, "battle", secret)?.scenes.battle.provider, "claude", "聞き直す AI = Claude (キーがあるとき)");
    assert.equal(fallbackAi(ai, "battle", () => null), undefined, "キーが無ければ、無し");
    assert.equal(fallbackAi({ ...ai, jev: { ...ai.jev, fallback: "none" } }, "battle", secret), undefined, "使わない設定なら、無し");
  }
  console.log("jev ok");
})();

// ---- aiStep: Jev で決める。自信が足りなければ、聞き直す AI。聞き直す AI が無ければ、Jev の答えのまま。失敗したら、以降は CPU
import { aiStep, JevDriver } from "../src/battle/aiRun";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { BattleController } from "../src/battle/play";
import { resetRegistry } from "../src/battle/registry";
import { GameCard, RuleBook, createGame } from "../src/battle/state";

(async () => {
  resetRegistry();
  registerBuiltinNodes();
  const call = (node: string, args: NodeCall["args"]): NodeCall => ({ node, args });
  const abilities: Record<string, Ability[]> = { Island: [{ kind: "activated", body: [call("cost", { tap: true }), call("addMana", { amount: 1, color: "U" })] }], Bear: [] };
  const rules: RuleBook = { get: (c) => (abilities[c] ? { card: c, abilities: abilities[c] } : undefined) };
  const mk = (id: string, typeLine: string, mv: number, owner: string, extra: Partial<GameCard> = {}): GameCard => ({ id, name: id.replace(/\d+$/, ""), typeLine, mv, owner, ...extra });
  const setup = () => {
    const g = createGame(["you", "opp"]);
    g.hands["opp"] = [mk("Island1", "Basic Land — Island", 0, "opp")];
    g.libraries["you"] = Array.from({ length: 10 }, (_, i) => mk(`Lib${i}`, "Instant", 1, "you"));
    g.libraries["opp"] = Array.from({ length: 10 }, (_, i) => mk(`OLib${i}`, "Instant", 1, "opp"));
    g.step = "main1";
    g.active = "opp";
    g.priority = "opp";
    return { g, c: new BattleController(g, rules, "you", () => 0.5, undefined, "opp") };
  };
  const driver = (confidence: number, threshold = 0.7): JevDriver & { calls: number } => {
    const d = {
      calls: 0,
      confidence: threshold,
      act: async (_s: string, options: { id: number; label: string }[]) => {
        d.calls++;
        return { reply: { choice: options.find((o) => o.label.startsWith("土地を出す"))?.id ?? 0 }, confidence, note: "jev: test", input: 300, output: 0, ms: 90 };
      },
      attack: async () => ({ reply: { attackers: [] }, confidence, note: "x", input: 1, output: 0, ms: 1 }),
      block: async () => ({ reply: { blocks: [] }, confidence, note: "x", input: 1, output: 0, ms: 1 }),
    };
    return d;
  };
  const llm = { calls: 0 };
  const ask = async () => ((llm.calls++), { text: '{"choice": 0, "why": "パス"}', input: 10, output: 5 });

  // 自信が足りて、Jev の答えを使う: 聞き直す AI は呼ばない。土地が出る
  {
    const { g, c } = setup();
    const j = driver(0.95);
    assert.equal(await aiStep(c, ask, "opp", j), "acted");
    assert.equal(j.calls, 1);
    assert.equal(llm.calls, 0, "自信が足りるので、聞き直さない");
    assert.equal(g.battlefield.some((p) => p.card.name === "Island"), true, "Jev の選んだ土地が出た");
    assert.ok(g.log.some((l) => l.startsWith("相手 (AI/jev): 採用")), "どちらで決めたかが、ログに残る");
    assert.equal(c.aiTokens.input, 300);
    assert.ok(c.aiNotes.some((n) => n.why === "jev: test"), "確率の説明が、履歴の裏側に残る");
  }
  // 自信が足りない: 聞き直す AI (パスを答える)
  {
    const { g, c } = setup();
    llm.calls = 0;
    assert.equal(await aiStep(c, ask, "opp", driver(0.4)), "acted");
    assert.equal(llm.calls, 1, "自信が足りないので、聞き直した");
    assert.equal(g.battlefield.some((p) => p.card.name === "Island"), false, "聞き直した答え (パス) に従う");
    assert.ok(g.log.some((l) => l.includes("自信が足りないので、別の AI に聞く")));
  }
  // 聞き直す AI が無い: 自信が低くても、Jev の答えを使う
  {
    const { g, c } = setup();
    assert.equal(await aiStep(c, undefined, "opp", driver(0.4)), "acted");
    assert.equal(g.battlefield.some((p) => p.card.name === "Island"), true);
  }
  // Jev が失敗: 聞き直す AI があれば、そちら。無ければ、以降は CPU
  {
    const failing: JevDriver = { ...driver(1), act: async () => { throw new Error("Jev の API キーが無効"); } };
    const a = setup();
    llm.calls = 0;
    assert.equal(await aiStep(a.c, ask, "opp", failing), "acted");
    assert.equal(llm.calls, 1);
    const b = setup();
    assert.equal(await aiStep(b.c, undefined, "opp", failing), "failed");
    assert.ok(b.g.log.some((l) => l.includes("キーが無効")));
  }
  console.log("jev aistep ok");
})();
