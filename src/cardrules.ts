import { App } from "obsidian";
import { cardInfo, oracleEnglish } from "./cards";
import { askClaude } from "./claude";
import { Ability, Macro, macrosUsedIn, normalizeAbility, unsupportedIn, validateMacro } from "./effects";
import { getMacros, saveMacro } from "./macros";
import { TYPE_ENTRIES } from "./typecatalog";
import { NeedSpec, PendingItem, newPendingId, readPending, writePending } from "./pending";
import { KEYWORDS, parseKeywords } from "./engine";
import { readRuleText, writeRuleText } from "./rulestore";

// カードごとの処理の記録 (Bot/Rules/<カード名>.md)。初回だけ AI (Claude) が効果テキストから作り、
// 以後は対戦エンジンが機械的に実行する。じゅまが読んで直してよい (直したものは上書きしない)
export const COMPILE_MODEL = "claude-sonnet-5-5";
// 効果の部品を増やしたら上げる。古い版で作った「一部未対応」の記録は、「ルール化」で作り直す
export const VOCAB_VERSION = 4;

export function sanitizeAbilities(raw: unknown, macros?: Map<string, Macro>): Ability[] {
  return Array.isArray(raw) ? raw.map((a) => normalizeAbility(a, macros)).filter((a): a is Ability => !!a) : [];
}

// ---- 読み書き ----

// エンジンが、キーワードとして自分で動かすもの (飛行・速攻・瞬速・威迫・絆魂・影など)。AI が「未対応」に書いても、未対応としては扱わない
export function isKeywordNoise(text: string): boolean {
  const parts = text.replace(/\(.*?\)/g, "").trim().toLowerCase().split(/\s*,\s*/).filter(Boolean);
  return parts.length > 0 && parts.every((p) => KEYWORDS.includes(p));
}
export const realUnsupported = (list: string[]) => [...new Set(list.map((t) => t.trim()))].filter((t) => t && !isKeywordNoise(t));

export interface Rule {
  abilities: Ability[];
  unsupported: string[]; // 「未対応」の文 (エンジンで動かない部分)
  status?: string; // ok / partial / manual
  vocab?: number; // 作ったときの部品の版
}

// 本文 (ルール md) を読んで、能力・未対応・status を取り出す
export function parseRule(text: string, macros?: Map<string, Macro>): Rule | undefined {
  const m = text.match(/```json\n([\s\S]*?)\n```/);
  if (!m) return undefined;
  try {
    const abilities = sanitizeAbilities(JSON.parse(m[1]).abilities, macros);
    const section = text.match(/## 未対応\n\n([\s\S]*?)\n\n##/)?.[1] ?? "";
    const unsupported = realUnsupported(section.split("\n").map((l) => l.replace(/^- /, "")).filter((l) => l.trim() !== "なし"));
    const vocab = Number(text.match(/^vocab: (\d+)$/m)?.[1]);
    return { abilities, unsupported, status: text.match(/^status: (\S+)$/m)?.[1], vocab: Number.isFinite(vocab) ? vocab : undefined };
  } catch {
    return undefined; // 壊れていたら記録が無いものとして扱う (直すまで効果は動かない)
  }
}

// 記録があればその内容、無ければ undefined (エンジンは効果テキストのマナ能力だけを持つ)
export async function loadRule(app: App, key: string): Promise<Rule | undefined> {
  const text = await readRuleText(app, key);
  return text === undefined ? undefined : parseRule(text, await getMacros(app));
}

export const loadAbilities = async (app: App, key: string) => (await loadRule(app, key))?.abilities;

// 古い版の部品で作った「一部未対応」の記録か (「ルール化」で作り直す対象。status を manual にすると守られる)
export const staleRule = (r?: Rule) => !!r && r.status === "partial" && (r.vocab === undefined || r.vocab < VOCAB_VERSION);
export async function isStale(app: App, key: string): Promise<boolean> {
  return staleRule(await loadRule(app, key));
}

// ルール md の本文を作る
export function ruleText(key: string, oracle: string, abilities: Ability[], unsupported: string[], meta: { by: string; status?: string; note?: string; raw?: unknown[] }): string {
  return [
    "---",
    "mtg: bot-rule",
    `card: "[[${key}]]"`,
    `generated_by: ${meta.by}`,
    `status: ${meta.status ?? (unsupported.length ? "partial" : "ok")}`,
    `vocab: ${VOCAB_VERSION}`,
    ...(meta.note ? [`instruction: ${JSON.stringify(meta.note)}`] : []),
    "---",
    "",
    "AI が作った処理の記録。対戦エンジンが機械的に実行する。ルールブック画面から直せる。status が partial のものは、効果の部品が増えたときに作り直される(manual と ok は作り直されない)。",
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
    JSON.stringify({ abilities: meta.raw ?? abilities }, null, 1), // マクロを使った記録は、使った形 (use) のまま残す
    "```",
    "",
  ].join("\n");
}

// 記録が要るカードか: 基本土地と、キーワードしか持たないカードは要らない
export function needsRule(typeLine: string, oracle: string): boolean {
  if (/\bBasic\b/.test(typeLine) && /\bLand\b/.test(typeLine)) return false;
  const lines = oracle.split("\n").map((l) => l.replace(/\(.*?\)/g, "").trim()).filter(Boolean);
  return lines.some((l) => !l.split(/\s*,\s*/).every((p) => parseKeywords(p).length === 1 && parseKeywords(p)[0] === p.toLowerCase()));
}

export const SPEC = `あなたは Magic: The Gathering の対戦エンジンのための「カード処理の記録」を作る。
カードの英語のオラクルテキストを読み、エンジンが機械的に実行できる JSON にする。エンジンが対応していないものは作り込まず、unsupported に書く。

# 出力 (JSON だけ。前置きや説明は書かない)
{"abilities": [Ability...], "unsupported": ["対応できなかった文を、原文のまま"]}

# Ability
- kind: "mana" (マナを出す起動型能力。スタックを使わない) / "activated" (起動型能力) / "triggered" (誘発型能力) / "spell" (インスタント・ソーサリーを唱えて解決したときの効果)
- kind: "static" (常在型能力。戦場にある間ずっと働く。いまは「起動の禁止」だけ): {"kind":"static","restrictions":[{"type":"cantActivate","what":CardSel}],"effects":[]}。what に合うパーマネントの、起動型能力 (マナ能力を含む) が起動できなくなる。what の owner を省くと、両方のプレイヤーに効く
- cost (mana / activated): {"tap": true, "mana": "{1}{W}", "life": 1, "sacrificeSelf": true}。使うものだけ書く
- trigger (triggered): {"event": "upkeep" | "etb" | "dies", "whose": "you" | "opponent" | "each"}。upkeep の whose は、誰のアップキープの開始時か。etb は「このカードが戦場に出たとき」、dies は「このカードが死亡したとき」だけ
- targets: 「対象の〜」を取るとき、[{"id": "t", "sel": CardSel | {"kind":"any"} | {"kind":"player","who":"you"|"opponent"|"each"}}]。effects からは {"kind":"ref","ref":"t"} で参照する。{"kind":"any"} は「クリーチャーかプレイヤー(かプレインズウォーカー)のいずれか1つ」
- optional: 「〜してもよい」なら true
- effects: 命令 (Step) の配列。上から順に実行する
- text: 日本語で20字以内の説明

# 命令 (Step)。「どうする」は do で決める
- {"do":"move","what":Selector,"to":Zone,"how":"draw"|"destroy"|"sacrifice"|"discard","position":"top"|"bottom","as":"名前"}
  カードをゾーンからゾーンへ移す。ドロー、捨てる、破壊、追放、手札に戻す、ミル、サーチ、蘇生、戦場に出す、は全部これ。
  - 引く: what が山札の上 {"kind":"cards","zone":"library","owner":"you","top":true,"count":N}、to が hand、how が draw
  - 捨てる: what が手札、to が graveyard、how が discard
  - 破壊: to が graveyard、how が destroy (破壊不能は死なない)。生け贄は how が sacrifice
  - 追放: to が exile。手札に戻す: to が hand。山札から出す(サーチ): what の zone が library、to が battlefield か hand
  - as は、結果に名前をつける (あとで参照するとき)
- {"do":"change","what":Selector,"stat":"life"|"damage","delta":Amount}
  stat が life: delta が正でライフを得る、負で失う。stat が damage: delta は与えるダメージ (正の数)
- {"do":"addMana","options":"B","n":3}  マナを出す。options は出せる色 (W U B R G C)。複数なら1度だけ色を選び n 個出す
- {"do":"shuffle","owner":"you"|"opponent"}
- {"do":"flip","win":[Step...],"lose":[Step...]}  コイン投げ
- {"do":"if","cond":Cond,"then":[Step...],"else":[Step...]}
- {"do":"may","steps":[Step...]}  「してもよい」。who が opponent なら相手が決める
- {"do":"unsupported","text":"..."}  効果の一部だけ対応できないとき、その部分に入れる

# Selector (何を)
- {"kind":"cards", ...}  カード。次の穴が使える (全部省略可):
  zone (library/hand/battlefield/graveyard/exile。既定は battlefield) / owner (you/opponent/any。戦場ではコントローラー、他のゾーンでは持ち主) /
  types (どれか。creature land artifact enchantment planeswalker instant sorcery permanent card) / subtypes (どれか。Plains Swamp など) / supertypes (すべて。legendary basic snow。「伝説のクリーチャー」は types:["creature"], supertypes:["legendary"]) /
  not (除く。land basic creature legendary artifact enchantment。「基本でない土地」は types:["land"], not:["basic"]) / name / cmc {"op":"<=","n":3} / power {"op":">=","n":4} /
  count (数 または "all"。既定は 1) / upTo (「N 枚まで」なら true) / chooser (選ぶ人。you / opponent。既定は能力のコントローラー。「相手に〜を選ばせる」は opponent、「あなたが選ぶ」は you) / top (山札の一番上から。選ばない)
- {"kind":"player","who":"you"|"opponent"|"each"|"controllerOf","ref":"名前"}  プレイヤー。controllerOf は、ref のカードのコントローラー
- {"kind":"ref","ref":"名前"}  targets の id か、as でつけた名前
- {"kind":"any"}  いずれか1つ (対象は targets で選ぶ)

# Amount (どれだけ)
数字 / {"of":"power"|"toughness"|"cmc","ref":"名前"} (そのカードのパワーなど) / {"count":CardSel} (数える。例: あなたの土地の数)

# Cond
{"cmp":[Amount,"<="|"<"|"="|">="|">",Amount]} / {"has":CardSel} (そのカードがある) / {"did":"名前"} (その名前の命令が1枚以上移した)

# キーワード能力
次のキーワードは、エンジンが自分で動かすので、abilities にも unsupported にも書かない: flying haste vigilance flash reach trample first strike double strike deathtouch lifelink menace defender indestructible hexproof shroud intimidate fear skulk shadow と、〜walk (土地渡り)。
これら以外のキーワード (evoke / kicker / flashback / ward / protection など) は、unsupported に書く。

# 能力にしないもの (unsupported に書く)
常在型能力のうち「起動の禁止」以外 (+1/+1 の修整、コストの増減、攻撃・ブロックの制限など)、代替コスト・追加コスト、置換効果、トークンを作る、カウンターを置く、ターン終了時までの一時的な効果、
「このカードが戦場に出たとき」「アップキープの開始時」「死亡したとき」以外のきっかけ (攻撃したとき、カードを引いたとき、呪文を唱えたとき) の誘発型能力、「呪文を打ち消す」「コントロールを得る」「コピーする」、装備・オーラ・プレインズウォーカー能力。

# マクロ (命令の組み合わせに、名前をつけた部品)
effects の中で {"do":"use","macro":"名前","args":{"引数":値}} と書ける。使えるマクロは、末尾の「登録済みのマクロ」。
同じ組み合わせが、他のカードにも出てきそうなときは、newMacros で新しいマクロを作ってよい: {"name":"英数字の名前","title":"日本語の名前","description":"何をするか","params":["n"],"steps":[命令...]}。
steps の中では、"$n" のように引数を使える。steps に使える命令は、move change addMana shuffle flip if may use だけ (unsupported は入れない)。

# 今の命令では書けないとき (needs)
その文は、effects に {"do":"unsupported","text":"原文"} として残し、needs に、新しい関数の仕様を書く: {"name":"createToken","title":"トークンを作る","description":"どう動くか","inputs":"受け取るもの","state":"必要なゲームの状態","waitFor":["todo.token"]}。
waitFor は、末尾の「まだ実装されていない型」の id から、いちばん近いものを選ぶ。当てはまるものが無ければ、"todo." + name にする。needs は、無ければ省く。

# 出力 (拡張)
{"abilities":[...],"newMacros":[...],"needs":[...],"unsupported":[...]}  (newMacros と needs は、無ければ省く)

# 例
Mana Crypt: {"abilities":[{"kind":"mana","cost":{"tap":true},"effects":[{"do":"addMana","options":"C","n":2}],"text":"無色2"},{"kind":"triggered","trigger":{"event":"upkeep","whose":"you"},"effects":[{"do":"flip","lose":[{"do":"change","what":{"kind":"player","who":"you"},"stat":"damage","delta":3}]}],"text":"コインに負けたら3点"}],"unsupported":[]}
Dark Ritual: {"abilities":[{"kind":"spell","effects":[{"do":"addMana","options":"B","n":3}],"text":"BBB"}],"unsupported":[]}
Black Lotus: {"abilities":[{"kind":"mana","cost":{"tap":true,"sacrificeSelf":true},"effects":[{"do":"addMana","options":"WUBRG","n":3}],"text":"生け贄で好きな1色を3つ"}],"unsupported":[]}
Thoughtseize: {"abilities":[{"kind":"spell","effects":[{"do":"move","what":{"kind":"cards","zone":"hand","owner":"opponent","not":["land"],"count":1,"chooser":"you"},"to":"graveyard","how":"discard"},{"do":"change","what":{"kind":"player","who":"you"},"stat":"life","delta":-2}],"text":"相手の土地以外を1枚捨てさせ、2点失う"}],"unsupported":[]}
Marsh Flats: {"abilities":[{"kind":"activated","cost":{"tap":true,"life":1,"sacrificeSelf":true},"effects":[{"do":"move","what":{"kind":"cards","zone":"library","owner":"you","subtypes":["Plains","Swamp"],"count":1,"chooser":"you"},"to":"battlefield"},{"do":"shuffle","owner":"you"}],"text":"平地か沼を探して出す"}],"unsupported":[]}
Swords to Plowshares: {"abilities":[{"kind":"spell","targets":[{"id":"t","sel":{"kind":"cards","types":["creature"]}}],"effects":[{"do":"move","what":{"kind":"ref","ref":"t"},"to":"exile","as":"x"},{"do":"change","what":{"kind":"player","who":"controllerOf","ref":"x"},"stat":"life","delta":{"of":"power","ref":"x"}}],"text":"クリーチャーを追放し、そのパワーぶん相手がライフを得る"}],"unsupported":[]}
Null Rod / Collector Ouphe: {"abilities":[{"kind":"static","restrictions":[{"type":"cantActivate","what":{"kind":"cards","types":["artifact"]}}],"effects":[],"text":"アーティファクトの起動型能力(マナ能力を含む)は起動できない"}],"unsupported":[]}
Wasteland: {"abilities":[{"kind":"mana","cost":{"tap":true},"effects":[{"do":"addMana","options":"C"}]},{"kind":"activated","cost":{"tap":true,"sacrificeSelf":true},"targets":[{"id":"t","sel":{"kind":"cards","types":["land"],"not":["basic"]}}],"effects":[{"do":"move","what":{"kind":"ref","ref":"t"},"to":"graveyard","how":"destroy"}],"text":"基本でない土地を破壊"}],"unsupported":[]}`;

export interface Compiled {
  key: string;
  ok: boolean;
  unsupported: string[];
  cost: number;
  error?: string;
}

// 指示書の末尾に付ける、いまの登録済みのマクロと、まだ実装されていない型
export function specFor(macros: Map<string, Macro>): string {
  const ms = [...macros.values()].map((m) => `- ${m.name}(${m.params.join(", ")}): ${m.title} — ${m.description}`);
  const planned = TYPE_ENTRIES.filter((e) => e.status === "planned").map((e) => `- ${e.id}: ${e.title} — ${e.summary}`);
  return `${SPEC}\n\n# 登録済みのマクロ\n${ms.length ? ms.join("\n") : "(まだ無い)"}\n\n# まだ実装されていない型 (needs の waitFor の候補)\n${planned.join("\n")}`;
}

export interface ProposalData {
  abilities: Ability[]; // 展開後 (エンジンが実行する形)
  raw: unknown[]; // 記録に書く形 (マクロは use のまま)
  unsupported: string[];
  macros: Macro[]; // 新しく作るマクロ
  needs: NeedSpec[]; // 実装待ちの関数の仕様
  errors: string[]; // 使えなかったマクロなど
}

// AI の返事 (JSON) を、検証した能力・マクロ・実装待ちにする
export function parseProposal(text: string, existing: Map<string, Macro> = new Map()): ProposalData {
  const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "");
  const errors: string[] = [];
  const table = new Map(existing);
  const macros: Macro[] = [];
  for (const raw of Array.isArray(parsed.newMacros) ? parsed.newMacros : []) {
    const v = validateMacro(raw);
    if (!v.macro) errors.push(`マクロを作れない: ${v.error}`);
    else if (existing.has(v.macro.name)) errors.push(`マクロ「${v.macro.name}」は既にある (上書きしない)`);
    else (macros.push(v.macro), table.set(v.macro.name, v.macro));
  }
  const rawAbilities: unknown[] = Array.isArray(parsed.abilities) ? parsed.abilities : [];
  const raw = rawAbilities.filter((a) => normalizeAbility(a, table));
  const abilities = sanitizeAbilities(raw, table);
  const found: string[] = (Array.isArray(parsed.unsupported) ? parsed.unsupported : []).map((u: unknown) => String(u));
  for (const a of abilities) found.push(...unsupportedIn(a.effects));
  const needs: NeedSpec[] = (Array.isArray(parsed.needs) ? parsed.needs : [])
    .map((n: Record<string, unknown>): NeedSpec => {
      const name = String(n.name ?? "").replace(/[^A-Za-z0-9]/g, "") || "newFunction";
      const wait = (Array.isArray(n.waitFor) ? n.waitFor.map(String) : []).filter(Boolean);
      return { name, title: String(n.title ?? name), description: String(n.description ?? ""), inputs: String(n.inputs ?? ""), state: String(n.state ?? ""), waitFor: wait.length ? wait : [`todo.${name}`] };
    })
    .filter((n: NeedSpec) => n.description);
  return { abilities, raw, unsupported: realUnsupported(found), macros, needs, errors };
}

// 案を保存する: マクロ、カードの記録、実装待ちの仕様。バックアップは、直す前の版を1つ前の分だけ残す
export async function applyProposal(app: App, key: string, p: ProposalData, instruction: string, meta: { status?: string; backup: boolean }): Promise<{ macros: number; needs: number }> {
  for (const m of p.macros) await saveMacro(app, m);
  const oracle = await oracleEnglish(app, key);
  await writeRuleText(app, key, ruleText(key, oracle, p.abilities, p.unsupported, { by: COMPILE_MODEL, status: meta.status, note: instruction || undefined, raw: p.raw }), meta.backup);
  if (p.needs.length) {
    const items = await readPending(app);
    items.push({ id: newPendingId(), key, instruction: instruction || oracle, needs: p.needs, created: new Date().toISOString(), status: "waiting" });
    await writePending(app, items);
  }
  return { macros: p.macros.length, needs: p.needs.length };
}

// 1枚の処理を AI に作らせて保存する。既にあれば何もしない (手で直したものを守る)
export async function compileCard(app: App, apiKey: string, key: string, overwrite = false): Promise<Compiled> {
  const info = cardInfo(app, key);
  if (!info) return { key, ok: false, unsupported: [], cost: 0, error: "カードのノートが無い" };
  if ((await readRuleText(app, key)) !== undefined && !overwrite) return { key, ok: true, unsupported: [], cost: 0 };
  const oracle = await oracleEnglish(app, key);
  try {
    const macros = await getMacros(app);
    const r = await askClaude(apiKey, COMPILE_MODEL, specFor(macros), `カード: ${info.name}\nタイプ: ${info.typeLine}\nマナコスト: ${info.manaCost}\n\nオラクルテキスト:\n${oracle}`, true);
    const p = parseProposal(r.text, macros);
    await applyProposal(app, key, p, "", { backup: overwrite });
    return { key, ok: true, unsupported: p.unsupported, cost: r.cost };
  } catch (e) {
    return { key, ok: false, unsupported: [], cost: 0, error: (e as Error).message };
  }
}

export interface Proposal {
  before: Rule | undefined;
  data: ProposalData;
  cost: number;
}

// あなたが書いた処理から、記録の案を作る (保存はしない。前後を見せて、確認してから保存する)
export async function proposeUpdate(app: App, apiKey: string, key: string, instruction: string): Promise<Proposal> {
  const info = cardInfo(app, key);
  if (!info) throw new Error("カードのノートが無い");
  const oracle = await oracleEnglish(app, key);
  const before = await loadRule(app, key);
  const macros = await getMacros(app);
  const rawText = await readRuleText(app, key);
  const current = rawText?.match(/```json\n([\s\S]*?)\n```/)?.[1];
  const r = await askClaude(apiKey, COMPILE_MODEL, specFor(macros), `カード: ${info.name}\nタイプ: ${info.typeLine}\nマナコスト: ${info.manaCost}\n\nオラクルテキスト:\n${oracle}\n\n今の記録:\n${current ?? "(記録なし)"}\n\nあなたが書いた処理 (この内容に沿って、記録を作り直す。書かれていない部分は、今の記録のまま残す。既にある関数・マクロで書けるものは、それで書く。足りない部分は needs に書く):\n${instruction}`, true);
  return { before, data: parseProposal(r.text, macros), cost: r.cost };
}

// 案を保存する。手で書いた処理なので status は manual (作り直されない)
export async function saveProposal(app: App, key: string, p: ProposalData, instruction: string) {
  return applyProposal(app, key, p, instruction, { status: "manual", backup: true });
}

export interface EnsureResult {
  made: number;
  failed: string[];
  partial: string[];
  cost: number;
}

// 記録が要るのに、まだ無いカードだけ、AI で作る。既にある記録は、一部未対応でも古くても作り直さない (トークンを使わない)。
// includeStale = true のときだけ、古い版の「一部未対応」も作り直す (デッキ画面の「ルール化」ボタンだけが使う)
export async function ensureRules(app: App, apiKey: string, keys: string[], opts: { includeStale?: boolean; progress?: (done: number, total: number, key: string) => void } = {}): Promise<EnsureResult> {
  const todo: { key: string; redo: boolean }[] = [];
  for (const key of new Set(keys)) {
    const info = cardInfo(app, key);
    if (!info) continue;
    if ((await readRuleText(app, key)) !== undefined) {
      if (opts.includeStale && (await isStale(app, key))) todo.push({ key, redo: true });
      continue;
    }
    if (needsRule(info.typeLine, await oracleEnglish(app, key))) todo.push({ key, redo: false });
  }
  const res: EnsureResult = { made: 0, failed: [], partial: [], cost: 0 };
  let done = 0;
  for (const t of todo) {
    opts.progress?.(++done, todo.length, t.key);
    const r = await compileCard(app, apiKey, t.key, t.redo);
    res.cost += r.cost;
    if (!r.ok) res.failed.push(`${t.key} (${r.error})`);
    else {
      res.made++;
      if (r.unsupported.length) res.partial.push(t.key);
    }
  }
  return res;
}
