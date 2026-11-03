import { App, TFile, normalizePath } from "obsidian";
import { cardInfo, oracleEnglish } from "./cards";
import { askClaude } from "./claude";
import { Ability, normalizeAbility, unsupportedIn } from "./effects";
import { parseKeywords } from "./engine";

// カードごとの処理の記録 (Bot/Rules/<カード名>.md)。初回だけ AI (Claude) が効果テキストから作り、
// 以後は対戦エンジンが機械的に実行する。じゅまが読んで直してよい (直したものは上書きしない)
export const RULE_DIR = "Bot/Rules";
export const COMPILE_MODEL = "claude-sonnet-5-5";
// 効果の部品を増やしたら上げる。古い版で作った「一部未対応」の記録は、「ルール化」で作り直す
export const VOCAB_VERSION = 3;

export function sanitizeAbilities(raw: unknown): Ability[] {
  return Array.isArray(raw) ? raw.map(normalizeAbility).filter((a): a is Ability => !!a) : [];
}

// ---- 読み書き ----

const path = (key: string) => normalizePath(`${RULE_DIR}/${key}.md`);

export interface Rule {
  abilities: Ability[];
  unsupported: string[]; // 「未対応」の文 (エンジンで動かない部分)
}

// 記録があればその内容、無ければ undefined (エンジンは効果テキストのマナ能力だけを持つ)
export async function loadRule(app: App, key: string): Promise<Rule | undefined> {
  const f = app.vault.getAbstractFileByPath(path(key));
  if (!(f instanceof TFile)) return undefined;
  const text = await app.vault.cachedRead(f);
  const m = text.match(/```json\n([\s\S]*?)\n```/);
  if (!m) return undefined;
  try {
    const abilities = sanitizeAbilities(JSON.parse(m[1]).abilities);
    const section = text.match(/## 未対応\n\n([\s\S]*?)\n\n##/)?.[1] ?? "";
    const unsupported = section.split("\n").map((l) => l.replace(/^- /, "").trim()).filter((l) => l && l !== "なし");
    return { abilities, unsupported };
  } catch {
    return undefined; // 壊れていたら記録が無いものとして扱う (直すまで効果は動かない)
  }
}

export const loadAbilities = async (app: App, key: string) => (await loadRule(app, key))?.abilities;

// 古い版の部品で作った「一部未対応」の記録か (「ルール化」で作り直す対象。status を manual に変えると守られる)
export function isStale(app: App, key: string): boolean {
  const f = app.vault.getAbstractFileByPath(path(key));
  const fm = f instanceof TFile ? app.metadataCache.getFileCache(f)?.frontmatter : undefined;
  return !!fm && fm.status === "partial" && (typeof fm.vocab !== "number" || fm.vocab < VOCAB_VERSION);
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
  types (どれか。creature land artifact enchantment planeswalker instant sorcery permanent card) / subtypes (どれか。Plains Swamp など) /
  not (除く。land basic creature legendary artifact enchantment。「基本でない土地」は types:["land"], not:["basic"]) / name / cmc {"op":"<=","n":3} / power {"op":">=","n":4} /
  count (数 または "all"。既定は 1) / upTo (「N 枚まで」なら true) / chooser (選ぶ人。you / opponent。既定は能力のコントローラー。「相手に〜を選ばせる」は opponent、「あなたが選ぶ」は you) / top (山札の一番上から。選ばない)
- {"kind":"player","who":"you"|"opponent"|"each"|"controllerOf","ref":"名前"}  プレイヤー。controllerOf は、ref のカードのコントローラー
- {"kind":"ref","ref":"名前"}  targets の id か、as でつけた名前
- {"kind":"any"}  いずれか1つ (対象は targets で選ぶ)

# Amount (どれだけ)
数字 / {"of":"power"|"toughness"|"cmc","ref":"名前"} (そのカードのパワーなど) / {"count":CardSel} (数える。例: あなたの土地の数)

# Cond
{"cmp":[Amount,"<="|"<"|"="|">="|">",Amount]} / {"has":CardSel} (そのカードがある) / {"did":"名前"} (その名前の命令が1枚以上移した)

# 能力にしないもの (unsupported に書く)
飛行・速攻などのキーワード能力、常在型能力 (+1/+1 の修整、コストの増減)、代替コスト・追加コスト、置換効果、トークンを作る、カウンターを置く、ターン終了時までの一時的な効果、
「このカードが戦場に出たとき」「アップキープの開始時」「死亡したとき」以外のきっかけ (攻撃したとき、カードを引いたとき、呪文を唱えたとき) の誘発型能力、「呪文を打ち消す」「コントロールを得る」「コピーする」、装備・オーラ・プレインズウォーカー能力。

# 例
Mana Crypt: {"abilities":[{"kind":"mana","cost":{"tap":true},"effects":[{"do":"addMana","options":"C","n":2}],"text":"無色2"},{"kind":"triggered","trigger":{"event":"upkeep","whose":"you"},"effects":[{"do":"flip","lose":[{"do":"change","what":{"kind":"player","who":"you"},"stat":"damage","delta":3}]}],"text":"コインに負けたら3点"}],"unsupported":[]}
Dark Ritual: {"abilities":[{"kind":"spell","effects":[{"do":"addMana","options":"B","n":3}],"text":"BBB"}],"unsupported":[]}
Black Lotus: {"abilities":[{"kind":"mana","cost":{"tap":true,"sacrificeSelf":true},"effects":[{"do":"addMana","options":"WUBRG","n":3}],"text":"生け贄で好きな1色を3つ"}],"unsupported":[]}
Thoughtseize: {"abilities":[{"kind":"spell","effects":[{"do":"move","what":{"kind":"cards","zone":"hand","owner":"opponent","not":["land"],"count":1,"chooser":"you"},"to":"graveyard","how":"discard"},{"do":"change","what":{"kind":"player","who":"you"},"stat":"life","delta":-2}],"text":"相手の土地以外を1枚捨てさせ、2点失う"}],"unsupported":[]}
Marsh Flats: {"abilities":[{"kind":"activated","cost":{"tap":true,"life":1,"sacrificeSelf":true},"effects":[{"do":"move","what":{"kind":"cards","zone":"library","owner":"you","subtypes":["Plains","Swamp"],"count":1,"chooser":"you"},"to":"battlefield"},{"do":"shuffle","owner":"you"}],"text":"平地か沼を探して出す"}],"unsupported":[]}
Swords to Plowshares: {"abilities":[{"kind":"spell","targets":[{"id":"t","sel":{"kind":"cards","types":["creature"]}}],"effects":[{"do":"move","what":{"kind":"ref","ref":"t"},"to":"exile","as":"x"},{"do":"change","what":{"kind":"player","who":"controllerOf","ref":"x"},"stat":"life","delta":{"of":"power","ref":"x"}}],"text":"クリーチャーを追放し、そのパワーぶん相手がライフを得る"}],"unsupported":[]}
Wasteland: {"abilities":[{"kind":"mana","cost":{"tap":true},"effects":[{"do":"addMana","options":"C"}]},{"kind":"activated","cost":{"tap":true,"sacrificeSelf":true},"targets":[{"id":"t","sel":{"kind":"cards","types":["land"],"not":["basic"]}}],"effects":[{"do":"move","what":{"kind":"ref","ref":"t"},"to":"graveyard","how":"destroy"}],"text":"基本でない土地を破壊"}],"unsupported":[]}`;

export interface Compiled {
  key: string;
  ok: boolean;
  unsupported: string[];
  cost: number;
  error?: string;
}

// 1枚の処理を AI に作らせて保存する。既にあれば何もしない (手で直したものを守る)
export async function compileCard(app: App, apiKey: string, key: string, overwrite = false): Promise<Compiled> {
  const info = cardInfo(app, key);
  if (!info) return { key, ok: false, unsupported: [], cost: 0, error: "カードのノートが無い" };
  const existing = app.vault.getAbstractFileByPath(path(key));
  if (existing && !overwrite) return { key, ok: true, unsupported: [], cost: 0 };
  const oracle = await oracleEnglish(app, key);
  try {
    const r = await askClaude(apiKey, COMPILE_MODEL, SPEC, `カード: ${info.name}\nタイプ: ${info.typeLine}\nマナコスト: ${info.manaCost}\n\nオラクルテキスト:\n${oracle}`, true);
    const json = r.text.match(/\{[\s\S]*\}/)?.[0];
    const parsed = JSON.parse(json ?? "");
    const abilities = sanitizeAbilities(parsed.abilities);
    const unsupported: string[] = (Array.isArray(parsed.unsupported) ? parsed.unsupported : []).map((u: unknown) => String(u));
    for (const a of abilities) unsupported.push(...unsupportedIn(a.effects));
    if (!app.vault.getAbstractFileByPath(RULE_DIR)) {
      if (!app.vault.getAbstractFileByPath("Bot")) await app.vault.createFolder("Bot");
      await app.vault.createFolder(RULE_DIR);
    }
    const body = [
        "---",
        "mtg: bot-rule",
        `card: "[[${key}]]"`,
        `generated_by: ${COMPILE_MODEL}`,
        `status: ${unsupported.length ? "partial" : "ok"}`,
        `vocab: ${VOCAB_VERSION}`,
        "tags: [mtg/bot-rule]",
        "---",
        "",
        "AI が初回だけ作った処理の記録。対戦エンジンが機械的に実行する。直してよい。status が partial のものは、効果の部品が増えたときに作り直されるので、手で直したら status を manual にする(manual と ok は上書きされない)。",
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
      ].join("\n");
    if (existing instanceof TFile) await app.vault.modify(existing, body);
    else await app.vault.create(path(key), body);
    return { key, ok: true, unsupported, cost: r.cost };
  } catch (e) {
    return { key, ok: false, unsupported: [], cost: 0, error: (e as Error).message };
  }
}
