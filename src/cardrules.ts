import { App, TFile, normalizePath } from "obsidian";
import { cardInfo, oracleEnglish } from "./cards";
import { askClaude } from "./claude";
import { Ability, Op, TargetSpec, parseKeywords } from "./engine";

// カードごとの処理の記録 (Bot/Rules/<カード名>.md)。初回だけ AI (Claude) が効果テキストから作り、
// 以後は対戦エンジンが機械的に実行する。じゅまが読んで直してよい (直したものは上書きしない)
export const RULE_DIR = "Bot/Rules";
export const COMPILE_MODEL = "claude-sonnet-5-5";

const KINDS = ["mana", "activated", "triggered", "spell"];
const EVENTS = ["upkeep", "etb", "dies"];
const TYPES = ["creature", "land", "artifact", "enchantment", "planeswalker", "permanent"];

const num = (x: unknown, d = 1) => (typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.floor(x)) : d);
const who = (x: unknown) => (x === "opponent" ? "opponent" : "you");

function target(x: unknown): TargetSpec {
  const t = (x ?? {}) as Record<string, unknown>;
  return {
    controller: t.controller === "you" || t.controller === "opponent" ? t.controller : "any",
    types: Array.isArray(t.types) ? (t.types.filter((y) => TYPES.includes(String(y))) as TargetSpec["types"]) : ["permanent"],
    ...(t.nonbasic ? { nonbasic: true } : {}),
  };
}

// 知らない効果や壊れた形は、実行せずに「未対応」にして残す (対戦を壊さない)
export function sanitizeOps(raw: unknown): Op[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r): Op => {
    const e = (r ?? {}) as Record<string, unknown>;
    switch (e.op) {
      case "addMana":
        return typeof e.options === "string" && /^[WUBRGC]+$/.test(e.options) ? { op: "addMana", options: e.options, n: num(e.n) } : { op: "unsupported", text: JSON.stringify(r) };
      case "draw":
        return { op: "draw", n: num(e.n), who: who(e.who) };
      case "gainLife":
      case "loseLife":
        return { op: e.op, n: num(e.n), who: who(e.who) };
      case "damage":
        return ["you", "opponent", "creature", "any"].includes(String(e.to)) ? { op: "damage", n: num(e.n), to: e.to as "you" } : { op: "unsupported", text: JSON.stringify(r) };
      case "flip":
        return { op: "flip", win: sanitizeOps(e.win), lose: sanitizeOps(e.lose) };
      case "destroy":
      case "exile":
        return { op: e.op, target: target(e.target) };
      default:
        return { op: "unsupported", text: typeof e.text === "string" ? e.text : JSON.stringify(r) };
    }
  });
}

export function sanitizeAbilities(raw: unknown): Ability[] {
  if (!Array.isArray(raw)) return [];
  const out: Ability[] = [];
  for (const r of raw) {
    const a = (r ?? {}) as Record<string, unknown>;
    if (!KINDS.includes(String(a.kind))) continue;
    const cost = (a.cost ?? {}) as Record<string, unknown>;
    const ab: Ability = { kind: a.kind as Ability["kind"], effects: sanitizeOps(a.effects) };
    if (a.cost) ab.cost = { ...(cost.tap ? { tap: true } : {}), ...(typeof cost.mana === "string" ? { mana: cost.mana } : {}), ...(cost.life ? { life: num(cost.life) } : {}), ...(cost.sacrificeSelf ? { sacrificeSelf: true } : {}) };
    if (ab.kind === "triggered") {
      const t = (a.trigger ?? {}) as Record<string, unknown>;
      if (!EVENTS.includes(String(t.event))) {
        ab.effects = [{ op: "unsupported", text: `未対応の誘発: ${JSON.stringify(a.trigger)}` }];
        continue;
      }
      ab.trigger = { event: t.event as "upkeep", whose: t.whose === "opponent" || t.whose === "each" ? t.whose : "you" };
    }
    if (a.optional) ab.optional = true;
    if (typeof a.text === "string") ab.text = a.text;
    out.push(ab);
  }
  return out;
}

// ---- 読み書き ----

const path = (key: string) => normalizePath(`${RULE_DIR}/${key}.md`);

// 記録があればその能力、無ければ undefined (エンジンは効果テキストのマナ能力だけを持つ)
export async function loadAbilities(app: App, key: string): Promise<Ability[] | undefined> {
  const f = app.vault.getAbstractFileByPath(path(key));
  if (!(f instanceof TFile)) return undefined;
  const m = (await app.vault.cachedRead(f)).match(/```json\n([\s\S]*?)\n```/);
  if (!m) return undefined;
  try {
    return sanitizeAbilities(JSON.parse(m[1]).abilities);
  } catch {
    return undefined; // 壊れていたら記録が無いものとして扱う (直すまで効果は動かない)
  }
}

// 記録が要るカードか: 基本土地と、キーワードしか持たないカードは要らない
export function needsRule(typeLine: string, oracle: string): boolean {
  if (/\bBasic\b/.test(typeLine) && /\bLand\b/.test(typeLine)) return false;
  const lines = oracle.split("\n").map((l) => l.replace(/\(.*?\)/g, "").trim()).filter(Boolean);
  return lines.some((l) => !l.split(/\s*,\s*/).every((p) => parseKeywords(p).length === 1 && parseKeywords(p)[0] === p.toLowerCase()));
}

const SPEC = `あなたは Magic: The Gathering の対戦エンジンのための「カード処理の記録」を作る。
カードの英語のオラクルテキストを読み、エンジンが機械的に実行できる JSON にする。エンジンが対応していないものは作り込まず、unsupported に書く。

# 出力 (JSON だけ。前置きや説明は書かない)
{"abilities": [Ability...], "unsupported": ["対応できなかった文を、原文のまま"]}

# Ability
- kind: "mana" (マナを出す起動型能力。スタックを使わない) / "activated" (起動型能力) / "triggered" (誘発型能力) / "spell" (インスタント・ソーサリーを唱えて解決したときの効果)
- cost (mana / activated): {"tap": true, "mana": "{1}{W}", "life": 1, "sacrificeSelf": true} 。使うものだけ書く
- trigger (triggered): {"event": "upkeep" | "etb" | "dies", "whose": "you" | "opponent" | "each"}。upkeep の whose は、誰のアップキープの開始時か。etb は「このカードが戦場に出たとき」、dies は「このカードが死亡したとき」だけ
- optional: 「〜してもよい」なら true
- effects: Op の配列
- text: 日本語で20字以内の説明

# Op (これだけ使える)
- {"op":"addMana","options":"B","n":3}  マナを出す。options は出せる色 (W U B R G C)。複数なら1度だけ色を選び n 個出す
- {"op":"draw","n":1,"who":"you"|"opponent"}
- {"op":"gainLife","n":1,"who":"you"|"opponent"} / {"op":"loseLife","n":1,"who":...}
- {"op":"damage","n":3,"to":"you"|"opponent"|"creature"|"any"}  creature / any は対象を選ぶ
- {"op":"flip","win":[Op...],"lose":[Op...]}  コイン投げ
- {"op":"destroy","target":{"controller":"you"|"opponent"|"any","types":["creature"|"land"|"artifact"|"enchantment"|"planeswalker"|"permanent"],"nonbasic":true}}
- {"op":"exile","target":{...同じ}}
- {"op":"unsupported","text":"..."}  効果の一部だけ対応できないとき、その部分に入れる

# 能力にしないもの
飛行・速攻などのキーワード能力、常在型能力 (+1/+1 の修整、コストの増減)、代替コスト、置換効果、戦闘以外のタップ・アンタップの細かい条件。これらは unsupported に書く。
「このカードが戦場に出たとき」「アップキープの開始時」「死亡したとき」以外のきっかけ (攻撃したとき、カードを引いたとき、呪文を唱えたとき) の誘発型能力も unsupported。

# 例
Mana Crypt: {"abilities":[{"kind":"mana","cost":{"tap":true},"effects":[{"op":"addMana","options":"C","n":2}],"text":"無色2"},{"kind":"triggered","trigger":{"event":"upkeep","whose":"you"},"effects":[{"op":"flip","lose":[{"op":"damage","n":3,"to":"you"}]}],"text":"コインに負けたら3点"}],"unsupported":[]}
Dark Ritual: {"abilities":[{"kind":"spell","effects":[{"op":"addMana","options":"B","n":3}],"text":"BBB"}],"unsupported":[]}
Black Lotus: {"abilities":[{"kind":"mana","cost":{"tap":true,"sacrificeSelf":true},"effects":[{"op":"addMana","options":"WUBRG","n":3}],"text":"生け贄で好きな1色を3つ"}],"unsupported":[]}`;

export interface Compiled {
  key: string;
  ok: boolean;
  unsupported: string[];
  cost: number;
  error?: string;
}

// 1枚の処理を AI に作らせて保存する。既にあれば何もしない (手で直したものを守る)
export async function compileCard(app: App, apiKey: string, key: string): Promise<Compiled> {
  const info = cardInfo(app, key);
  if (!info) return { key, ok: false, unsupported: [], cost: 0, error: "カードのノートが無い" };
  if (app.vault.getAbstractFileByPath(path(key))) return { key, ok: true, unsupported: [], cost: 0 };
  const oracle = await oracleEnglish(app, key);
  try {
    const r = await askClaude(apiKey, COMPILE_MODEL, SPEC, `カード: ${info.name}\nタイプ: ${info.typeLine}\nマナコスト: ${info.manaCost}\n\nオラクルテキスト:\n${oracle}`, true);
    const json = r.text.match(/\{[\s\S]*\}/)?.[0];
    const parsed = JSON.parse(json ?? "");
    const abilities = sanitizeAbilities(parsed.abilities);
    const unsupported: string[] = (Array.isArray(parsed.unsupported) ? parsed.unsupported : []).map((u: unknown) => String(u));
    for (const a of abilities) for (const e of a.effects) if (e.op === "unsupported") unsupported.push(e.text);
    if (!app.vault.getAbstractFileByPath(RULE_DIR)) {
      if (!app.vault.getAbstractFileByPath("Bot")) await app.vault.createFolder("Bot");
      await app.vault.createFolder(RULE_DIR);
    }
    await app.vault.create(
      path(key),
      [
        "---",
        "mtg: bot-rule",
        `card: "[[${key}]]"`,
        `generated_by: ${COMPILE_MODEL}`,
        `status: ${unsupported.length ? "partial" : "ok"}`,
        "tags: [mtg/bot-rule]",
        "---",
        "",
        "AI が初回だけ作った処理の記録。対戦エンジンが機械的に実行する。直してよい(直したものは上書きされない)。",
        "",
        "## オラクルテキスト",
        "",
        oracle,
        "",
        "## 未対応",
        "",
        ...(unsupported.length ? unsupported.map((u) => `- ${u}`) : ["- なし"]),
        "",
        "## 処理",
        "",
        "```json",
        JSON.stringify({ abilities }, null, 1),
        "```",
        "",
      ].join("\n"),
    );
    return { key, ok: true, unsupported, cost: r.cost };
  } catch (e) {
    return { key, ok: false, unsupported: [], cost: 0, error: (e as Error).message };
  }
}
