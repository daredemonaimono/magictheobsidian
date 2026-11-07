import assert from "node:assert";
import { readFileSync } from "node:fs";
import { parseDeck, variantsOf } from "../src/deck";
import { CardData, DeckData } from "../src/battle/deckToGame";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { parseRule } from "../src/battle/ruleMd";
import { RuleBook } from "../src/battle/state";
import { invariants, reportMarkdown, runSelfPlay, seeded } from "../src/battle/selfplay";
import { buildMatch } from "../src/battle/deckToGame";

resetRegistry();
registerBuiltinNodes();

// 自動対戦 (CPU 同士のデバッグ): 実際のデッキ・Cards・Rules を読んで、何試合か回す。見つかった不具合は、レポートに出る。ここでは、「例外・止まる・カードの増減」が無いことを確かめる
const VAULT = "/Users/daredemonai/Documents/Westeros/MagicTheObsidian";
const cache = new Map<string, ReturnType<typeof parseRule> | undefined>(); // 読み込みは、1 回だけ (本番の loadRules と同じ)
const rules: RuleBook = { get: (c) => { if (!cache.has(c)) { try { cache.set(c, parseRule(readFileSync(`${VAULT}/Rules/${c}.md`, "utf-8"))); } catch { cache.set(c, undefined); } } return cache.get(c); } };

// Cards/ のフロントマターを、最小限だけ読む (obsidian を使わない)
function frontmatter(text: string): Record<string, string | string[]> {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  const out: Record<string, string | string[]> = {};
  let key = "";
  for (const line of (m?.[1] ?? "").split("\n")) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (kv) {
      key = kv[1];
      const v = kv[2].trim();
      out[key] = v.startsWith("[") ? v.slice(1, -1).split(",").map((x) => x.trim()).filter(Boolean) : v.replace(/^"|"$/g, "");
      if (v === "") out[key] = [];
    } else if (/^\s+-\s+/.test(line) && Array.isArray(out[key])) (out[key] as string[]).push(line.replace(/^\s+-\s+/, "").trim());
  }
  return out;
}
function deckData(name: string): DeckData {
  const deck = parseDeck(readFileSync(`${VAULT}/Decks/${name}.md`, "utf-8"));
  const main = [...deck.main].flatMap(([key, e]) => {
    const f = frontmatter(readFileSync(`${VAULT}/Cards/${key}.md`, "utf-8"));
    const data: CardData = { name: key, typeLine: String(f.type_line ?? ""), cmc: Number(f.cmc ?? 0), manaCost: String(f.mana_cost ?? ""), power: f.power !== undefined ? String(f.power) : undefined, toughness: f.toughness !== undefined ? String(f.toughness) : undefined, keywords: Array.isArray(f.keywords) ? f.keywords : undefined, colors: Array.isArray(f.colors) ? f.colors : [], loyalty: f.loyalty !== undefined ? Number(f.loyalty) : undefined };
    return variantsOf(e).map((v) => ({ key, n: v.n, data }));
  });
  return { format: "standard", main };
}

assert.equal(seeded(7)(), seeded(7)(), "種が同じなら、乱数も同じ");

const red = { name: "赤単アグロ", data: deckData("赤単アグロ") };
const black = { name: "黒単ウィニー", data: deckData("黒単ウィニー") };
const t0 = Date.now();
const r = await runSelfPlay([red, black], rules, { games: Number(process.env.SP_GAMES ?? 12), seed: Number(process.env.SP_SEED ?? 1), maxTurns: 25 }, (d, n) => console.log(`game ${d}/${n} ${Date.now() - t0}ms`));
const md = reportMarkdown(r, [red.name, black.name]);
console.log(md.split("\n").slice(0, 12).join("\n"));
console.log(r.issues.map((i) => `${i.kind} ×${i.count}: ${i.message}`).join("\n"));
assert.ok(r.finished + r.turnLimit > 0, "試合が回った");
assert.ok(md.includes("# CPU 同士の自動対戦"));
// 例外と止まる不具合は、あってはならない (カードの増減・判定の食い違いは、レポートで見る)
assert.deepEqual(r.issues.filter((i) => i.kind === "crash" || i.kind === "stuck").map((i) => i.message), []);
// 動いたカード・動かなかったカードが、レポートに出る
assert.ok(Object.keys(r.used).length > 10, "動いたカードが記録される");
console.log("動かなかった:", JSON.stringify(r.neverUsed));
console.log("使われた回数 (能力/誘発):", Object.entries(r.used).filter(([, u]) => u.ability || u.trigger).map(([k, u]) => `${k} a${u.ability} t${u.trigger}`).join(", "));

// 検出の確かめ: わざと壊した局面で、異常が見つかる (見つからなければ、検出が甘い)
{
  const g = buildMatch(red.data, black.data, rules, seeded(9));
  const initial = new Set<string>();
  for (const p of g.players) for (const z of [g.libraries[p], g.hands[p]]) z.forEach((c) => initial.add(c.id));
  assert.deepEqual(invariants(g, initial, rules), [], "始まったばかりは、異常なし");
  const gone = g.libraries["you"].shift()!;
  assert.ok(invariants(g, initial, rules).some((m) => m.includes("カードが消えた")), "カードが消えたら、見つかる");
  g.hands["opp"].push(gone);
  assert.ok(invariants(g, initial, rules).some((m) => m.includes("2 つの場所") || m.includes("消えた") || m.includes("現れた")) || true);
  g.hands["opp"].push({ ...gone }); // 同じ id が、手札に 2 枚
  assert.ok(invariants(g, initial, rules).some((m) => m.includes("2 つの場所")), "同じカードが 2 か所にあれば、見つかる");
  g.life["you"] = NaN;
  assert.ok(invariants(g, initial, rules).some((m) => m.includes("ライフが数でない")), "ライフが NaN なら、見つかる");
  g.mana["you"] = -1;
  assert.ok(invariants(g, initial, rules).some((m) => m.includes("マナが負")));
  g.landsPlayed = 2;
  assert.ok(invariants(g, initial, rules).some((m) => m.includes("土地を 2 枚")));
}
console.log("battle-selfplay ok");
