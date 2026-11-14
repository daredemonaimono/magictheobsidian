import assert from "node:assert/strict";
import { abilityLabel, candidates, hasSource, mergeCandidates } from "../src/node/split";
import { setLang } from "../src/i18n";
import { cmpCr } from "../src/node/cr";
import { EIGHTH_EDITION, MAGIC_2015, eraOf, frameEra } from "../src/node/frame";
import { moveItem } from "../src/node/order";
import { ACTIONS, CONDITIONS } from "../src/node/actions";
import { KEYWORDS, TARGETS } from "../src/node/slots";
import { CARD_TYPES, cardTypeOf } from "../src/node/cardtypes";
import { KINDS, defaultTiming, timingOf } from "../src/node/kinds";
import { NodeData } from "../src/node/md";
import { abilityBlock, parseCardMd, toCardMd } from "../src/node/card";
import { artFileName, artOf, buildQuery, isScryfallImage, cardsOf, fromScryfall, printsFrom, printsUrl, scryfallUrl } from "../src/node/scryfall";
import { validate } from "../src/node/validate";

// 能力の種類は、この 5 つ
assert.deepEqual(KINDS.map((k) => k.label.ja), ["呪文能力", "起動型", "誘発型", "常在型", "キーワード能力"]); // CR の番号順 (112.3a・602・603・604・702)
assert.deepEqual(KINDS.map((k) => k.label.en), ["Spell", "Activated", "Triggered", "Static", "Keyword"]);

// 威迫: キーワード能力。ブロックの条件を課す (誘発ではない)
const menace: NodeData = { name: "Menace", kind: "keyword", timing: "always", steps: [{ node: false, id: "block-requirement", args: { "min-blockers": "2" } }] };
// 獰猛 (パワー4以上): 誘発型。攻撃したとき、条件つきで +2/+2 (ターン終了時まで)
const ferocious: NodeData = {
  name: "Ferocious",
  kind: "triggered",
  timing: "attacks",
  target: "self",
  condition: { id: "controls-power-at-least", args: { n: "4" } },
  steps: [{ node: false, id: "modify-pt", args: { power: "2", toughness: "2", duration: "until-eot" } }],
};
const none = () => undefined;
// ノードは、カードのノートの中の、コードブロックで書き、読む
const toMd = (n: NodeData) => toCardMd({ name: "C", abilities: [n] });
const parseMd = (md: string) => parseCardMd(md).abilities[0];

for (const lang of ["ja", "en"] as const) {
  setLang(lang);
  // 書いて読むと、元に戻る (どちらの言語でも)
  for (const n of [menace, ferocious]) assert.deepEqual(parseMd(toMd(n)), n, lang);
  assert.deepEqual(validate(menace, none), []);
  assert.deepEqual(validate(ferocious, none), []);
}

// カードのノートは、どの言語の設定でも、英語で書き出す (フロントマター・キー・値のすべて)
for (const lang of ["ja", "en"] as const) {
  setLang(lang);
  const md = toMd(ferocious);
  assert.ok(md.startsWith("---\nmtg: card\n---\n# C\n"), md);
  assert.ok(md.includes("```mtg-node\nname: Ferocious\nkind: Triggered\ntiming: When it attacks\ncondition: controlsPowerAtLeast(n=4)\ntarget: this object\nsteps:\n  modifyPT(power=2, toughness=2, duration=until-eot)\n```"), md);
}
setLang("ja");
// 飛行を与える常在型 (全クリーチャー) と、キーワード「飛行」
const giveFlying: NodeData = { name: "GiveFlying", kind: "static", timing: "always", target: "each", targetArgs: { controller: "any", type: "creature", color: "any" }, steps: [{ node: false, id: "grant-keyword", args: { keyword: "flying" } }] };
const flying: NodeData = { name: "Flying", kind: "keyword", timing: "always", keyword: "flying", steps: [] };
for (const lang of ["ja", "en"] as const) {
  setLang(lang);
  for (const n of [giveFlying, flying]) { assert.deepEqual(parseMd(toMd(n)), n, lang); assert.deepEqual(validate(n, none), [], lang); }
}
setLang("en");
assert.ok(toMd(menace).includes("\n  blockRequirement(min-blockers=2)\n"));

setLang("ja");
// 検証: ルールに反するもの (日本語の文)
const bad = (n: Partial<NodeData>, get: (x: string) => NodeData | undefined = none) => validate({ ...ferocious, ...n }, get).join(" / ");
assert.match(bad({ kind: "x" }), /種類 "x"/);
assert.match(bad({ timing: "always" }), /タイミング "always" は、誘発型にない/);
assert.match(validate({ ...menace, kind: "triggered", timing: "attacks" }, none).join(), /常在型 \/ キーワード能力でだけ/, "威迫の動作は、誘発では使えない");
assert.match(bad({ steps: [] }), /手順が空/);
assert.match(bad({ steps: [{ node: false, id: "deal-damage", args: { amount: "x" } }] }), /量 は整数/);
assert.match(bad({ steps: [{ node: false, id: "deal-damage", args: {} }] }), /量 が無い/);
assert.match(bad({ name: "a]]b" }), /名前が空か/);
assert.match(bad({ name: "" }), /名前が空か/);
assert.deepEqual(validate({ ...ferocious, name: "{T}: Add {G}. / 自由な文字?" }, none), [], "能力の名前は、原文そのままでよい (ファイル名ではない)");
setLang("en");
assert.match(bad({ timing: "always" }), /Timing "always" does not exist for Triggered/, "英語の文");

// 参照: 無いノード・循環
setLang("ja");
const useIt: NodeData = { ...ferocious, name: "親", steps: [{ node: true, id: "Ferocious" }] };
assert.match(validate(useIt, none).join(), /\[\[Ferocious\]\] が無い/);
assert.deepEqual(validate(useIt, (n) => (n === "Ferocious" ? ferocious : undefined)), []);
const a: NodeData = { ...ferocious, name: "A", steps: [{ node: true, id: "B" }] };
const b: NodeData = { ...ferocious, name: "B", steps: [{ node: true, id: "A" }] };
assert.match(validate(a, (n) => (n === "B" ? b : n === "A" ? a : undefined)).join(), /循環: A → B → A/);

// 旧い書き方 (文) も読める
assert.deepEqual(parseMd("---\nmtg: card\n---\n# C\n\n```node\n名前: M\n種類: キーワード能力\nタイミング: 戦場にいる間\n手順:\n  ブロックの条件を課す: 最少のブロッカー数=2\n```\n").steps, [{ node: false, id: "block-requirement", args: { "min-blockers": "2" } }]);

// カードタイプごとの、唱えられるタイミング (絶対条件)。タイミング id は、kinds.ts にある
assert.equal(cardTypeOf("instant")?.castTiming, "anytime");
assert.equal(cardTypeOf("sorcery")?.castTiming, "sorcery-speed");
assert.equal(cardTypeOf("creature")?.castTiming, "sorcery-speed");
for (const c of CARD_TYPES) assert.ok(timingOf("activated", c.castTiming), c.id);

// カード: 能力のノードが、コードブロックで入る (どちらの言語でも往復できる)
const card = { name: "夜に吼える追跡者", type: "creature", abilities: [menace, ferocious, giveFlying, flying] };
for (const lang of ["ja", "en"] as const) {
  setLang(lang);
  assert.deepEqual(parseCardMd(toCardMd(card)), card, lang);
}
const cardEn = toCardMd(card);
assert.ok(cardEn.includes("type: Creature\n"), cardEn);
// 日本語で書かれたカードのノートも、読める
const jaMd = "---\nmtg: card\nカードタイプ: クリーチャー\n---\n# X\n\n## 能力\n\n```node\n名前: Ferocious\n種類: 誘発型\nタイミング: 攻撃したとき\n条件: controlsPowerAtLeast(n=4)\n対象: このクリーチャー\n手順:\n  modifyPT(power=2, toughness=2, duration=until-eot)\n```\n";
assert.deepEqual(parseCardMd(jaMd), { name: "X", type: "creature", abilities: [ferocious] });
setLang("ja");
assert.throws(() => parseCardMd("---\nmtg: node\n---\n# x\n"), /mtg: card/);

// Scryfall の取り込み
assert.match(scryfallUrl("Lightning Bolt"), /cards\/search\?q=Lightning%20Bolt&unique=cards/);
assert.equal(cardsOf({ object: "list", data: [{ id: "a", name: "a" }], id: "", name: "" }).length, 1);
assert.match(scryfallUrl("稲妻"), /cards\/search\?q=%E7%A8%B2%E5%A6%BB%20lang%3Aja/);
const bolt = fromScryfall({ id: "x1", name: "Lightning Bolt", mana_cost: "{R}", type_line: "Instant", oracle_text: "Lightning Bolt deals 3 damage to any target." });
assert.equal(bolt.type, "instant");
assert.equal(bolt.mana, "{R}");
const ja2 = fromScryfall({ object: "list", data: [{ id: "x2", name: "Savage Stalker", printed_name: "夜に吼える追跡者", lang: "ja", type_line: "Artifact Creature — Wolf", mana_cost: "{2}{G}", printed_text: "威迫\n獰猛", oracle_text: "Menace" }] });
assert.equal(ja2.name, "Savage Stalker"); // 日本語で探しても、カードのノートは英語
assert.equal(ja2.type, "artifact"); // 複数のタイプは、cardtypes.ts (CR の番号順) で最初のもの (唱えるタイミングは、どれも同じ)
assert.equal(ja2.text, "Menace");
const dfc = fromScryfall({ id: "x3", name: "A // B", card_faces: [{ name: "A", type_line: "Creature — Human", oracle_text: "a", mana_cost: "{1}" }, { name: "B", type_line: "Creature — Wolf", oracle_text: "b" }] });
assert.equal(dfc.name, "A // B");
assert.equal(dfc.type, "creature");
assert.equal(dfc.text, "a\n//\nb");
assert.throws(() => fromScryfall({ object: "list", data: [], id: "", name: "" }), /no card/);
// 取り込んだ情報も、カードのノートに往復する
for (const lang of ["ja", "en"] as const) {
  setLang(lang);
  const imp = { ...ja2, abilities: [ferocious] };
  assert.deepEqual(parseCardMd(toCardMd(imp)), imp, lang);
}

// 検索の絞り込み: 名前・タイプ・色
assert.equal(buildQuery(" bolt ", { colors: [], type: "" }), "bolt");
assert.equal(buildQuery("", { colors: ["R", "G"], type: "creature" }), "t:creature c:rg");
assert.equal(buildQuery("", { colors: [], type: "" }), "");
assert.equal(fromScryfall({ id: "x4", name: "N", image_uris: { art_crop: "https://x/art.jpg" } }).art, "https://x/art.jpg");
{
  setLang("en");
  const withArt = { name: "N", scryfall: "x4", mana: "{R}", typeLine: "Instant", art: "https://x/art.jpg", text: "a\nb", type: "instant", abilities: [] };
  assert.deepEqual(parseCardMd(toCardMd(withArt)), withArt);
}

// 原文から、能力の候補
setLang("en");
const stalker = {
  name: "Savage Stalker", type: "creature", keywords: ["Menace", "Flying"],
  text: "Menace, flying (reminder)\nWhenever Savage Stalker attacks, if you control a creature with power 4 or greater, it gets +2/+2 until end of turn.\n{T}: Add {G}.\n{2}, {T}: Draw a card. Activate only as a sorcery.\nCreatures you control have flying.",
  abilities: [],
};
const cands = candidates(stalker);
// 種類・タイミングは、推さない (初期値)。キーワードだけの行だけは、キーワード能力
assert.deepEqual(cands.map((x) => [x.node.kind, x.node.timing, x.node.keyword]), [
  ["keyword", "always", undefined], ["keyword", "always", "flying"], ["static", "always", undefined], ["static", "always", undefined], ["static", "always", undefined], ["static", "always", undefined],
]);
// 名前 = 原文の行そのまま (キーワードは、その名前)
assert.deepEqual(cands.map((x) => x.node.name), ["Menace", "Flying", "Whenever Savage Stalker attacks, if you control a creature with power 4 or greater, it gets +2/+2 until end of turn.", "{T}: Add {G}.", "{2}, {T}: Draw a card. Activate only as a sorcery.", "Creatures you control have flying."]);
assert.equal(new Set(cands.map((x) => x.node.name)).size, cands.length, "名前は、重ならない");
assert.equal(candidates({ name: "D", abilities: [], text: "Draw a card.\nDraw a card." }).map((x) => x.node.name).join("|"), "Draw a card.|Draw a card. 2", "同じ行は、番号で区別する");
assert.deepEqual(candidates({ name: "L", abilities: [] }), []);
assert.equal(fromScryfall({ id: "k", name: "K", keywords: ["Flying"] }).keywords?.[0], "Flying");
{
  const withKw = { name: "K", keywords: ["Flying", "Menace"], abilities: [] };
  assert.deepEqual(parseCardMd(toCardMd(withKw)), withKw);
}

// 設定が日本語: 日本語の名前・原文・タイプ行も、ノートに保存する (キー・見出しは英語)。展開 (候補) も日本語
const stalkerJa = fromScryfall({ id: "j", name: "Savage Stalker", type_line: "Creature — Wolf", keywords: ["Menace"], oracle_text: "Menace\nWhenever Savage Stalker attacks, it gets +2/+2 until end of turn.", printed_name: "夜に吼える追跡者", printed_type_line: "クリーチャー — 狼", printed_text: "威迫\n夜に吼える追跡者が攻撃するたび、それはターン終了時まで+2/+2の修整を受ける。" }, true);
assert.equal(stalkerJa.nameJa, "夜に吼える追跡者");
assert.equal(fromScryfall({ id: "j", name: "S", printed_name: "日" }).nameJa, undefined, "設定が英語なら、日本語は入れない");
setLang("ja");
const jaMd2 = toCardMd(stalkerJa);
assert.ok(jaMd2.includes("name-ja: 夜に吼える追跡者\n") && jaMd2.includes("## Rules text (ja)\n\n> 威迫\n> 夜に吼える") && jaMd2.includes("## Rules text\n\n> Menace"), jaMd2);
assert.deepEqual(parseCardMd(jaMd2), stalkerJa);
assert.deepEqual(candidates(stalkerJa, "ja").map((x) => x.line), ["威迫", "夜に吼える追跡者が攻撃するたび、それはターン終了時まで+2/+2の修整を受ける。"]);
assert.deepEqual(candidates(stalkerJa, "ja").map((x) => x.node.kind), ["keyword", "static"], "キーワード以外は、種類を推さない");
assert.equal(candidates(stalkerJa, "ja")[1].node.name, "夜に吼える追跡者が攻撃するたび、それはターン終了時まで+2/+2の修整を受ける。", "日本語の原文が、そのまま名前");
assert.equal(candidates(stalkerJa, "ja")[1].node.source, "Whenever Savage Stalker attacks, it gets +2/+2 until end of turn.", "source は、英語 (判定用)");
assert.deepEqual(candidates(stalkerJa, "en").map((x) => x.line)[0], "Menace");
assert.deepEqual(candidates({ ...stalkerJa, textJa: "1行だけ" }, "ja").map((x) => x.line)[0], "Menace", "行の数が合わなければ、英語");

// 版違い (すべての印刷) の絵
assert.match(printsUrl("abc"), /unique=prints&order=released/);
assert.equal(artOf({ image_uris: { art_crop: "A" } } as any), "A");
assert.equal(artOf({ card_faces: [{ image_uris: { art_crop: "B" } }] } as any), "B");
assert.equal(artOf({} as any), undefined);
const prints = printsFrom({ object: "list", id: "", name: "", data: [
  { id: "p1", name: "B", set: "lea", collector_number: "161", released_at: "1993-08-05", image_uris: { art_crop: "https://x/1.jpg" } },
  { id: "p2", name: "B", set: "m10", collector_number: "146", card_faces: [{ image_uris: { art_crop: "https://x/2.jpg" } }] },
  { id: "p3", name: "B", set: "xx", collector_number: "1" }, // 絵が無いものは、入れない
] });
assert.deepEqual(prints, [{ id: "p1", set: "lea", number: "161", released: "1993-08-05", art: "https://x/1.jpg" }, { id: "p2", set: "m10", number: "146", released: "", art: "https://x/2.jpg" }]);
{
  setLang("ja");
  const withPrints = { name: "Lightning Bolt", prints, abilities: [menace] };
  const md = toCardMd(withPrints);
  assert.ok(md.includes("## Printings\n\n- lea 161 1993-08-05 p1 https://x/1.jpg\n- m10 146 - p2 https://x/2.jpg\n"), md);
  assert.deepEqual(parseCardMd(md), withPrints);
}

// 絵のキャッシュ
assert.equal(artFileName("7673784e-db4b-43a1-8d55-1bb9fc1e284f"), "7673784e-db4b-43a1-8d55-1bb9fc1e284f.jpg");
assert.equal(artFileName("../../x"), "x.jpg", "id にパスは入れない");
assert.ok(isScryfallImage("https://cards.scryfall.io/art_crop/front/a/b.jpg?1"));
assert.ok(!isScryfallImage("https://example.com/a.jpg") && !isScryfallImage("file:///etc/passwd"));

// 多相 (702.73): キーワード能力。すべてのクリーチャー・タイプになる (特性を定義する能力)
setLang("en");
const changeling = candidates({ name: "Cairn Wanderer", keywords: ["Changeling"], text: "Changeling (This card is every creature type.)", abilities: [] })[0].node;
assert.deepEqual(changeling, { source: "Changeling", name: "Changeling", kind: "keyword", timing: "always", keyword: "changeling", steps: [{ node: false, id: "all-creature-types", args: {} }] });
for (const lang of ["ja", "en"] as const) {
  setLang(lang);
  assert.deepEqual(validate(changeling, none), [], lang);
  assert.deepEqual(parseMd(toMd(changeling)), changeling, lang);
}
assert.ok(toMd(changeling).includes("keyword: Changeling\nsteps:\n  setAllCreatureTypes()\n"));
setLang("ja");
assert.match(validate({ ...changeling, kind: "triggered", timing: "attacks" }, none).join(), /常在型 \/ キーワード能力でだけ/, "誘発では使えない");
assert.deepEqual(candidates({ name: "C", keywords: ["Changeling"], text: "Changeling", textJa: "多相", abilities: [] }, "ja").map((x) => x.node.name), ["多相"]);

// 石塚の放浪者 (Cairn Wanderer): 墓地に、そのキーワードを持つクリーチャー・カードがあるかぎり、それを持つ (12 個のキーワードは、それぞれ別々に判定)
const KW12 = "flying|fear|first-strike|double-strike|deathtouch|haste|landwalk|lifelink|protection|reach|trample|shroud|vigilance".split("|");
const cairn: NodeData = {
  name: "Graveyard keywords",
  kind: "static",
  timing: "always",
  target: "self",
  condition: { id: "graveyard-has-keyword-creature", args: { keyword: KW12.join("|") } },
  steps: [{ node: false, id: "grant-keyword", args: { keyword: KW12.join("|") } }],
};
for (const lang of ["ja", "en"] as const) {
  setLang(lang);
  assert.deepEqual(validate(cairn, none), [], lang);
  assert.deepEqual(parseMd(toMd(cairn)), cairn, lang);
}
setLang("en");
assert.ok(toMd(cairn).includes("condition: graveyardHasCreatureWithKeyword(keyword=flying|fear|first-strike|"), toMd(cairn));
assert.deepEqual(parseMd(toMd(cairn).replace(/flying\|fear/g, "Flying|Fear")), cairn, "ラベルでも読める");
setLang("ja");
assert.match(validate({ ...cairn, steps: [{ node: false, id: "grant-keyword", args: { keyword: "flying|nope" } }] }, none).join(), /キーワード は .* のどれか/);
assert.match(validate({ ...cairn, steps: [{ node: false, id: "grant-keyword", args: { keyword: "" } }] }, none).join(), /キーワード は .* のどれか/, "空は不可");

// 原文の行 (source): 能力が、どの原文の行から作られたかを覚える (名前が変わっても、できているか分かる)
for (const lang of ["ja", "en"] as const) {
  setLang(lang);
  const fromText = { ...ferocious, source: "Whenever it attacks, it gets +2/+2." };
  assert.deepEqual(parseCardMd(toCardMd({ name: "C", abilities: [fromText] })).abilities[0], fromText, lang);
}
assert.ok(toMd({ ...ferocious, source: "Whenever it attacks" }).includes("name: Ferocious\nsource: Whenever it attacks\nkind: Triggered"));
{
  const cs = candidates(stalker, "en");
  assert.deepEqual(cs.map((x) => x.node.source), ["Menace", "flying", "Whenever Savage Stalker attacks, if you control a creature with power 4 or greater, it gets +2/+2 until end of turn.", "{T}: Add {G}.", "{2}, {T}: Draw a card. Activate only as a sorcery.", "Creatures you control have flying."]);
  assert.ok(cs[2].alt.length === 2, "旧い名前 (原文の切り抜き) も、見つける");
}

// 原文そのままの名前 (コロン・括弧・記号を含む) も、保存して読める
for (const lang of ["ja", "en"] as const) {
  setLang(lang);
  const odd = { ...ferocious, name: "{T}: Add {G}. (注: 例) / #1?", source: "{T}: Add {G}." };
  assert.deepEqual(parseCardMd(toCardMd({ name: "C", abilities: [odd] })).abilities[0], odd, lang);
}

// 突進するサイ (Charging Rhino): 2 体以上のクリーチャーによってはブロックされない = ブロッカーは 1 体まで
const rhino: NodeData = { name: "Charging Rhino can't be blocked by more than one creature.", kind: "static", timing: "always", target: "self", steps: [{ node: false, id: "max-blockers", args: { "max-blockers": "1" } }] };
for (const lang of ["ja", "en"] as const) {
  setLang(lang);
  assert.deepEqual(validate(rhino, none), [], lang);
  assert.deepEqual(parseMd(toMd(rhino)), rhino, lang);
}
setLang("en");
assert.ok(toMd(rhino).includes("\n  setMaxBlockers(max-blockers=1)\n"));
setLang("ja");
assert.match(validate({ ...rhino, kind: "triggered", timing: "attacks" }, none).join(), /常在型 \/ キーワード能力でだけ/);
assert.match(validate({ ...rhino, steps: [{ node: false, id: "max-blockers", args: { "max-blockers": "x" } }] }, none).join(), /整数/);

// 種類ごとの色 (画面の背景色): 5 種類、それぞれ別の色
assert.equal(new Set(KINDS.map((k) => k.color)).size, KINDS.length);

// 能力の名前の表示: 言語を切り替えると、原文からできた能力は、その言語の原文。書き換えた名前は、そのまま
{
  const card2 = { ...stalkerJa, abilities: [] as NodeData[] };
  const made = candidates(card2, "ja")[1].node; // 設定が日本語のときに作った (名前 = 日本語の原文)
  card2.abilities = [made];
  assert.equal(abilityLabel(card2, made, "ja"), "夜に吼える追跡者が攻撃するたび、それはターン終了時まで+2/+2の修整を受ける。");
  assert.equal(abilityLabel(card2, made, "en"), "Whenever Savage Stalker attacks, it gets +2/+2 until end of turn.", "英語に切り替えると、英語の原文");
  assert.equal(abilityLabel(card2, { ...made, name: "My name" }, "en"), "My name", "書き換えた名前は、そのまま");
  assert.equal(abilityLabel(card2, { ...made, name: "夜に吼える追跡者が攻撃するたび、それはターン終了時まで+2/+2の修整を受ける。".slice(0, 40).trim() }, "en"), "Whenever Savage Stalker attacks, it gets +2/+2 until end of turn.", "旧い (40 字の) 名前も、自動の名前");
  const kw = candidates(card2, "ja")[0].node;
  assert.equal(abilityLabel(card2, kw, "ja"), "威迫");
  assert.equal(abilityLabel(card2, kw, "en"), "Menace");
  assert.equal(abilityLabel(card2, { name: "手で作った", kind: "static", timing: "always", steps: [] }, "en") === "手で作った", true);
}

// 複数行で 1 つの能力 (合体): source は、複数行。名前は、行をつなげたもの
{
  const fow = { name: "Force of Will", type: "instant", text: "You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost.\nCounter target spell.", abilities: [] as NodeData[] };
  const cs = candidates(fow, "en");
  assert.equal(cs.length, 2);
  const merged = mergeCandidates(cs);
  assert.equal(merged.source, cs[0].node.source + "\n" + cs[1].node.source);
  assert.equal(merged.name, cs[0].node.name + " / " + cs[1].node.name);
  assert.ok(hasSource(merged, cs[0].node.source) && hasSource(merged, cs[1].node.source), "合体した能力は、どの行からもできている");
  assert.ok(!hasSource({ ...merged, source: undefined }, cs[0].node.source));
  for (const lang of ["ja", "en"] as const) {
    setLang(lang);
    const back = parseCardMd(toCardMd({ ...fow, abilities: [merged] })).abilities[0];
    assert.deepEqual(back, merged, lang);
  }
  setLang("en");
  assert.ok(toCardMd({ ...fow, abilities: [merged] }).includes("\nsource:\n  You may pay 1 life"), "複数行は、字下げで書く");
  fow.abilities = [merged];
  assert.equal(abilityLabel(fow, merged, "en"), merged.name);
  assert.equal(abilityLabel(fow, { ...merged, name: "代替コスト + 打ち消し" }, "en"), "代替コスト + 打ち消し", "書き換えた名前は、そのまま");
}

// Force of Will (意志の力): 2 つの能力。代替コスト (常在型・唱えるとき・手順 = コスト) と、呪文能力 (対象の呪文を打ち消す)
const fowAlt: NodeData = {
  name: "Alternative cost", kind: "static", timing: "alternative-cost",
  steps: [{ node: false, id: "pay-life", args: { amount: "1" } }, { node: false, id: "exile-from-hand", args: { count: "1", color: "blue" } }],
};
const fowSpell: NodeData = { name: "Counter", kind: "spell", timing: "resolves", target: "target-spell", steps: [{ node: false, id: "counter", args: {} }] };
const fow = { name: "Force of Will", type: "instant", mana: "{3}{U}{U}", abilities: [fowAlt, fowSpell] };
for (const lang of ["ja", "en"] as const) {
  setLang(lang);
  for (const a of fow.abilities) assert.deepEqual(validate(a, none), [], lang);
  assert.deepEqual(parseCardMd(toCardMd(fow)), fow, lang);
}
setLang("en");
assert.ok(toCardMd(fow).includes("timing: May be paid instead of the mana cost when casting\nsteps:\n  payLife(amount=1)\n  exileFromHand(count=1, color=blue)\n"), toCardMd(fow));
assert.ok(toCardMd(fow).includes("target: target spell\nsteps:\n  counter()\n"));
assert.equal(cardTypeOf("instant")?.castTiming, "anytime", "インスタント: 優先権があれば、いつでも唱えられる");
setLang("ja");
assert.match(validate({ ...fowAlt, steps: [{ node: false, id: "exile-from-hand", args: { count: "1", color: "purple" } }] }, none).join(), /色 は .* のどれか/);

// 思考の反映 (Thought Reflection): あなたがカードを 1 枚引くなら、代わりに、2 枚引く = 置換効果 (誘発ではない: 614.1)。タイミング = 置き換える出来事
const reflection: NodeData = { name: "Draw replacement", kind: "static", timing: "replace-draw", steps: [{ node: false, id: "draw", args: { amount: "2" } }] };
for (const lang of ["ja", "en"] as const) {
  setLang(lang);
  assert.deepEqual(validate(reflection, none), [], lang);
  assert.deepEqual(parseMd(toMd(reflection)), reflection, lang);
}
setLang("en");
assert.ok(toMd(reflection).includes("timing: If you would draw a card, instead\nsteps:\n  draw(amount=2)\n"), toMd(reflection));
setLang("ja");
assert.match(validate({ ...reflection, kind: "triggered" }, none).join(), /タイミング "replace-draw" は、誘発型にない/, "置換は、常在型のタイミング");

// CR の番号順: 作った順ではなく、番号順に並ぶ
assert.ok(cmpCr("701.6", "701.13") < 0 && cmpCr("701.13", "701.6") > 0, "数として比べる");
assert.ok(cmpCr("613.1f", "613.4c") < 0 && cmpCr("509.1b", "509.1i") < 0);
assert.ok(cmpCr("702", "702.1") < 0, "短いほうが先");
assert.ok(cmpCr("113.3a", "602") < 0 && cmpCr("604.1", "614.11") < 0);
assert.equal(cmpCr("603.6c", "603.6c"), 0);
assert.ok(cmpCr("999", "") < 0 && cmpCr("", "999") > 0, "番号が無いものは、最後");
const sortedByCr = (xs: { cr: string }[]) => xs.every((x, i) => i === 0 || cmpCr(xs[i - 1].cr, x.cr) <= 0);
for (const [name, xs] of Object.entries({ KINDS, ACTIONS, CONDITIONS, TARGETS, KEYWORDS, CARD_TYPES })) assert.ok(sortedByCr(xs), `${name} は、CR の番号順`);
for (const k of KINDS) assert.ok(sortedByCr(k.timings), `${k.id} のタイミングは、CR の番号順`);
for (const k of KINDS) assert.ok(timingOf(k.id, defaultTiming(k.id)), `${k.id} の初期のタイミングがある`);
assert.equal(defaultTiming("static"), "always", "並びが変わっても、初期のタイミングは、変わらない");

// トークン: 名前にパワー・タフネス・色を入れて区別。type は、トークンのタイプ行から
{
  const elfBG = fromScryfall({ id: "t1", name: "Elf", layout: "token", type_line: "Token Creature — Elf", power: "2", toughness: "2", colors: ["B", "G"], oracle_text: "" });
  const elfG = fromScryfall({ id: "t2", name: "Elf", layout: "token", type_line: "Token Creature — Elf", power: "1", toughness: "1", colors: ["G"] });
  const clue = fromScryfall({ id: "t3", name: "Clue", layout: "token", type_line: "Token Artifact — Clue", colors: [] });
  assert.equal(elfBG.name, "Elf Token (2-2 BG)");
  assert.equal(elfG.name, "Elf Token (1-1 G)", "同じ名前でも、区別できる");
  assert.equal(clue.name, "Clue Token (C)", "パワー・タフネスが無いものは、色だけ (無色は C)");
  assert.equal(elfBG.token, true);
  assert.equal(elfBG.type, "creature");
  assert.equal(fromScryfall({ id: "c", name: "Elf", layout: "normal" }).token, undefined, "トークンでなければ、付けない");
  assert.equal(buildQuery("elf", { colors: [], type: "token" }), "elf t:token");
  for (const lang of ["ja", "en"] as const) {
    setLang(lang);
    assert.deepEqual(parseCardMd(toCardMd({ ...elfBG, abilities: [] })), elfBG, lang);
  }
  assert.ok(!toCardMd({ ...fromScryfall({ id: "c", name: "X" }), abilities: [] }).includes("token:"));
}

// 炎の侍祭、チャンドラ (Chandra, Flamecaller) の 0 能力: 赤の 1/1 のエレメンタル・トークンを 2 体生成する。トークンは、登録してあるトークンのカードを指す
const chandra: NodeData = { name: "0: tokens", kind: "activated", timing: "loyalty", loyalty: "0", steps: [{ node: false, id: "create-token", args: { count: "2", token: "Elemental Token (1-1 R)" } }] };
const tokenCards = new Map([["Elemental Token (1-1 R)", { name: "Elemental Token (1-1 R)", token: true, abilities: [] }], ["Lightning Bolt", { name: "Lightning Bolt", abilities: [] }], ["Vraska Emblem", { name: "Vraska Emblem", emblem: true, abilities: [] }]]);
const hasCard = (n: string, f?: string) => { const c = tokenCards.get(n) as { token?: boolean; emblem?: boolean } | undefined; return !!c && (f !== "token" || !!c.token) && (f !== "emblem" || !!c.emblem); };
for (const lang of ["ja", "en"] as const) {
  setLang(lang);
  assert.deepEqual(validate(chandra, none, hasCard), [], lang);
  assert.deepEqual(parseMd(toMd(chandra)), chandra, lang);
}
setLang("en");
assert.ok(toMd(chandra).includes("\n  createToken(count=2, token=Elemental Token (1-1 R))\n"), toMd(chandra));
setLang("ja");
const withToken = (token: string): NodeData => ({ ...chandra, steps: [{ node: false, id: "create-token", args: { count: "2", token } }] });
assert.match(validate(withToken("Elemental Token (9-9 R)"), none, hasCard).join(), /登録されていない/, "登録していないカードは、指せない");
assert.match(validate(withToken("Lightning Bolt"), none, hasCard).join(), /登録されていない/, "トークンでないカードは、指せない");
assert.match(validate(withToken(""), none, hasCard).join(), /トークン が無い/, "空は不可");
assert.deepEqual(validate(withToken("Anything"), none), [], "確認の関数が無ければ、確認しない");

// 炎の侍祭、チャンドラの 0 能力の全文: 赤の 1/1 のエレメンタルを 2 体生成する。それらは速攻を得る。次の終了ステップの開始時に、それらを生け贄に捧げる
const chandraFull: NodeData = {
  name: "0: tokens", kind: "activated", timing: "loyalty", loyalty: "0", target: "created-tokens",
  steps: [
    { node: false, id: "create-token", args: { count: "2", token: "Elemental Token (1-1 R)" } },
    { node: false, id: "grant-keyword", args: { keyword: "haste" } },
    { node: false, id: "delayed-trigger", args: { when: "end-step" } },
    { node: false, id: "sacrifice", args: {} },
  ],
};
for (const lang of ["ja", "en"] as const) {
  setLang(lang);
  assert.deepEqual(validate(chandraFull, none, hasCard), [], lang);
  assert.deepEqual(parseMd(toMd(chandraFull)), chandraFull, lang);
}
setLang("en");

// Ruling report の部品で組めるカード (検証が通り、md に書き出して、読み戻せる)
const fromReport: NodeData[] = [
  { name: "−3: Destroy", kind: "activated", timing: "loyalty", loyalty: "-3", target: "target-object", targetArgs: { controller: "any", type: "artifact|creature|enchantment|planeswalker", color: "any", "mana-value-max": "3" }, steps: [{ node: false, id: "destroy", args: {} }] },
  { name: "Food", kind: "activated", timing: "anytime", cost: [{ id: "pay-mana", args: { mana: "{2}" } }, { id: "tap-self", args: {} }, { id: "sacrifice-cost", args: { what: "self" } }], steps: [{ node: false, id: "gain-life", args: { amount: "3" } }] },
  { name: "Narcomoeba", kind: "triggered", timing: "graveyard-from-library", target: "self", steps: [{ node: false, id: "may-do", args: {} }, { node: false, id: "move-zone", args: { to: "battlefield" } }] },
  { name: "Landfall", kind: "triggered", timing: "land-enters", target: "self", steps: [{ node: false, id: "may-pay", args: { mana: "{4}{R}{R}" } }, { node: false, id: "move-zone", args: { to: "battlefield" } }] },
  { name: "Cast trigger", kind: "triggered", timing: "cast", steps: [{ node: false, id: "extra-turn", args: { count: "1" } }] },
  { name: "Uncounterable", kind: "static", timing: "always", steps: [{ node: false, id: "cant-be-countered", args: {} }] },
  { name: "Chain", kind: "spell", timing: "resolves", target: "any-target", steps: [{ node: false, id: "deal-damage", args: { amount: "3" } }, { node: false, id: "may-pay", args: { mana: "{R}{R}" } }, { node: false, id: "copy-spell", args: { "new-targets": "may-choose" } }] },
  { name: "Annihilator", kind: "keyword", timing: "attacks", keyword: "annihilator", steps: [{ node: false, id: "sacrifice-by", args: { who: "defending-player", count: "6", what: "permanent" } }] },
  { name: "Frodo", kind: "triggered", timing: "attacks", condition: { id: "gained-life-at-least", args: { n: "3" } }, steps: [{ node: false, id: "ring-tempts", args: {} }] },
  // 報告書 (2回目) から: 条件つきの手順・働く領域・紋章・呪文の追加コスト・手順を行う人・プロテクション・パートナー
  { name: "Frodo then", kind: "triggered", timing: "attacks", steps: [{ node: false, id: "only-if", args: { condition: "is-ring-bearer" } }, { node: false, id: "only-if", args: { condition: "ring-tempted-at-least", n: "2" } }, { node: false, id: "draw", args: { amount: "1" } }] },
  { name: "From graveyard", kind: "triggered", timing: "land-enters", target: "self", steps: [{ node: false, id: "functions-from", args: { zone: "graveyard" } }, { node: false, id: "may-pay", args: { mana: "{4}{R}{R}" } }, { node: false, id: "move-zone", args: { to: "battlefield" } }] },
  { name: "Emblem", kind: "spell", timing: "resolves", steps: [{ node: false, id: "create-emblem", args: { emblem: "Vraska Emblem" } }] },
  { name: "Blizzard", kind: "spell", timing: "resolves", cost: [{ id: "pay-mana", args: { mana: "{2}" } }], target: "target-creature", steps: [{ node: false, id: "move-zone", args: { to: "hand" } }] },
  { name: "Chain", kind: "spell", timing: "resolves", target: "any-target", steps: [{ node: false, id: "may-pay", args: { mana: "{R}{R}", who: "controller-of-target" } }, { node: false, id: "copy-spell", args: { "new-targets": "may-choose", who: "controller-of-target" } }] },
  { name: "Prot", kind: "keyword", timing: "always", keyword: "protection", steps: [{ node: false, id: "protection-from", args: { what: "spells", color: "colored" } }] },
  { name: "Partner", kind: "keyword", timing: "always", keyword: "partner", steps: [{ node: false, id: "partner-with", args: { name: "Sam, Loyal Attendant" } }] },
  { name: "Cast self", kind: "triggered", timing: "cast-self", steps: [{ node: false, id: "extra-turn", args: { count: "1" } }] },
  { name: "Emblem trigger", kind: "triggered", timing: "creature-combat-damage", target: "target-player", steps: [{ node: false, id: "lose-game", args: {} }] },
  { name: "Anywhere", kind: "spell", timing: "resolves", target: "each", targetArgs: { controller: "you", zone: "any", type: "card", color: "any" }, steps: [{ node: false, id: "move-zone", args: { to: "exile" } }] },
];
for (const lang of ["ja", "en"] as const) {
  setLang(lang);
  for (const n of fromReport) {
    assert.deepEqual(validate(n, none, hasCard), [], `${lang}: ${n.name}`);
    assert.deepEqual(parseMd(toMd(n)), n, `${lang}: ${n.name} (md)`);
  }
}
setLang("en");
assert.ok(validate({ ...fromReport[2], steps: [{ node: false, id: "may-do", args: {} }] }, none, hasCard).length, "「してもよい」の後ろが空なら、問題");
assert.ok(validate({ name: "x", kind: "triggered", timing: "attacks", steps: [{ node: false, id: "only-if", args: { condition: "is-ring-bearer" } }] }, none, hasCard).length, "「条件が成り立つときだけ」の後ろが空なら、問題");
assert.ok(validate({ name: "x", kind: "triggered", timing: "attacks", steps: [{ node: false, id: "only-if", args: { condition: "ring-tempted-at-least" } }, { node: false, id: "draw", args: { amount: "1" } }] }, none, hasCard).length, "数のある条件には、N が要る");
assert.ok(validate({ name: "x", kind: "keyword", timing: "always", keyword: "partner", steps: [{ node: false, id: "partner-with", args: { name: "" } }] }, none, hasCard).length, "text の引数は、空だと、問題");
assert.ok(validate({ name: "x", kind: "spell", timing: "resolves", steps: [{ node: false, id: "create-emblem", args: { emblem: "Not a card" } }] }, none, hasCard).length, "登録していない紋章は、問題");
assert.ok(toMd(chandraFull).includes("timing: Loyalty ability (your main phase, empty stack, once per turn)\nloyalty: 0\n"), toMd(chandraFull));
assert.ok(toMd(chandraFull).includes("target: them (the tokens this ability created)\nsteps:\n  createToken(count=2, token=Elemental Token (1-1 R))\n  grantKeyword(keyword=haste)\n  delay(when=end-step)\n  sacrifice()\n"), toMd(chandraFull));
setLang("ja");
assert.match(validate({ ...chandraFull, steps: chandraFull.steps.slice(1) }, none, hasCard).join(), /トークンを生成する手順が要る/, "「それら」には、生成する手順がいる");
assert.match(validate({ ...chandraFull, steps: chandraFull.steps.slice(0, 3) }, none, hasCard).join(), /遅延誘発/, "遅延誘発の後ろは、空にできない");
assert.match(validate({ ...chandraFull, steps: [{ node: false, id: "delayed-trigger", args: { when: "someday" } }, chandraFull.steps[3]] }, none, hasCard).join(), /タイミング は .* のどれか/);

// 能力の入れ替え (ドラッグ)
{
  const xs = ["a", "b", "c", "d"];
  assert.equal(moveItem(xs, 0, 2), true);
  assert.deepEqual(xs, ["b", "c", "a", "d"], "前から後ろへ");
  assert.equal(moveItem(xs, 3, 0), true);
  assert.deepEqual(xs, ["d", "b", "c", "a"], "後ろから前へ");
  assert.equal(moveItem(xs, 1, 1), false, "同じ位置は、動かさない");
  assert.equal(moveItem(xs, -1, 2) || moveItem(xs, 0, 9) || moveItem(xs, NaN, 1), false, "範囲外は、動かさない");
  assert.deepEqual(xs, ["d", "b", "c", "a"]);
}

// 忠誠度能力 (606): コスト (+1・0・-2) と、タイミング「忠誠度能力」(606.3) は、組。起動型でだけ
{
  setLang("ja");
  const walk = (loyalty: string | undefined, timing = "loyalty", kind = "activated"): NodeData => ({ ...chandraFull, kind, timing, loyalty });
  assert.deepEqual(validate(walk("-2"), none, hasCard), [], "-2");
  assert.deepEqual(validate(walk("+1"), none, hasCard), [], "+1");
  assert.match(validate(walk("x"), none, hasCard).join(), /忠誠度のコスト "x" は、整数/);
  assert.match(validate(walk(undefined), none, hasCard).join(), /組で持つ/, "タイミングだけ");
  assert.match(validate(walk("0", "sorcery-speed"), none, hasCard).join(), /組で持つ/, "コストだけ");
  assert.match(validate(walk("0", "always", "static"), none, hasCard).join(), /起動型でだけ/);
  assert.deepEqual(parseMd(toMd(walk("-2"))).loyalty, "-2");
  // 「−」(U+2212) で書かれたものも、読める
  assert.equal(parseMd(toMd(walk("-2")).replace("loyalty: -2", "loyalty: \u22122")).loyalty, "-2");
  const pw = fromScryfall({ id: "p", name: "Chandra, Flamecaller", type_line: "Legendary Planeswalker — Chandra", loyalty: "4" });
  assert.equal(pw.loyalty, "4");
  assert.equal(pw.type, "planeswalker");
  for (const lang of ["ja", "en"] as const) { setLang(lang); assert.deepEqual(parseCardMd(toCardMd({ ...pw, abilities: [walk("-2")] })), { ...pw, abilities: [walk("-2")] }, lang); }
}

// 炎の侍祭、チャンドラの 0 能力 (もう 1 つ): あなたがコントロールしている赤の各プレインズウォーカーの上に、忠誠カウンターを 1 個ずつ置く = 対象を取らない「各〜」
const chandraCounters: NodeData = {
  name: "0: counters", kind: "activated", timing: "loyalty", loyalty: "0",
  target: "each", targetArgs: { controller: "you", type: "planeswalker", color: "red" },
  steps: [{ node: false, id: "add-counter", args: { kind: "loyalty", amount: "1" } }],
};
for (const lang of ["ja", "en"] as const) {
  setLang(lang);
  assert.deepEqual(validate(chandraCounters, none, hasCard), [], lang);
  assert.deepEqual(parseMd(toMd(chandraCounters)), chandraCounters, lang);
}
setLang("en");
assert.ok(toMd(chandraCounters).includes("target: eachObject(controller=you, type=planeswalker, color=red)\n"), toMd(chandraCounters));
assert.ok(toMd({ ...chandraCounters, target: "self", targetArgs: undefined }).includes("target: this object\n"), "引数の無い対象は、ラベルのまま");
setLang("ja");
assert.match(validate({ ...chandraCounters, targetArgs: { controller: "you", type: "planeswalker", color: "purple" } }, none, hasCard).join(), /色 は .* のどれか/);
assert.match(validate({ ...chandraCounters, targetArgs: undefined }, none, hasCard).join(), /プレイヤー が無い/, "引数が無いと、止まる");
// ラベルでも読める (日本語で書かれた引数)
assert.deepEqual(parseMd(toMd(chandraCounters).replace("controller=you, type=planeswalker, color=red", "プレイヤー=あなた, タイプ=プレインズウォーカー, 色=赤")).targetArgs, chandraCounters.targetArgs);

// 炎の侍祭、チャンドラの −2 能力: 墓地の、マナ総量 3 以下のインスタントかソーサリーのカード 1 枚を対象とする。このターン、唱えてもよい。このターン、墓地に置かれるなら、代わりに追放する
const minus2: NodeData = {
  name: "-2: …", kind: "activated", timing: "loyalty", loyalty: "-2", target: "target-object",
  targetArgs: { controller: "you", zone: "graveyard", type: "instant|sorcery", color: "any", "mana-value-max": "3" },
  steps: [{ node: false, id: "may-cast", args: { duration: "this-turn" } }, { node: false, id: "exile-instead-of-graveyard", args: { duration: "this-turn" } }],
};
for (const lang of ["ja", "en"] as const) {
  setLang(lang);
  assert.deepEqual(validate(minus2, none, hasCard), [], lang);
  assert.deepEqual(parseMd(toMd(minus2)), minus2, lang);
}
setLang("en");
assert.ok(toMd(minus2).includes("target: targetObject(controller=you, zone=graveyard, type=instant|sorcery, color=any, mana-value-max=3)\nsteps:\n  mayCast(duration=this-turn)\n"), toMd(minus2));
setLang("ja");
// 無くてもよい引数 (optional): マナ総量・領域は、無くても通る。書く値が空なら、md に出さない
const noLimit = { ...minus2, targetArgs: { controller: "you", type: "instant", color: "any" } };
assert.deepEqual(validate(noLimit, none, hasCard), [], "領域・マナ総量は、無くてもよい");
assert.ok(!toMd({ ...minus2, targetArgs: { ...minus2.targetArgs!, "mana-value-max": "" } }).includes("mana-value-max"), "空の値は、md に書かない");
assert.match(validate({ ...minus2, targetArgs: { ...minus2.targetArgs!, "mana-value-max": "three" } }, none, hasCard).join(), /整数/, "書いたなら、整数");
assert.match(validate({ ...minus2, targetArgs: { ...minus2.targetArgs!, zone: "moon" } }, none, hasCard).join(), /領域 は .* のどれか/);
assert.match(validate({ ...minus2, targetArgs: { controller: "you", color: "any" } }, none, hasCard).join(), /タイプ が無い/, "タイプは、必須");
// 各〜も、同じ絞り込みを使う (領域・マナ総量は、あとから足した引数。前に保存した各〜も、そのまま通る)
assert.deepEqual(validate({ ...chandraCounters, targetArgs: { controller: "you", type: "planeswalker", color: "red" } }, none, hasCard), []);

// 魔力の櫃 (Mana Vault): アンタップしない / アップキープに {4} を支払ってもよい。そうしたなら、アンタップする / ドロー・ステップに、タップ状態なら 1 点のダメージ / {T}: {C}{C}{C} を加える
const vaultUntap: NodeData = { name: "u", kind: "static", timing: "always", target: "self", steps: [{ node: false, id: "does-not-untap", args: {} }] };
const vaultUpkeep: NodeData = { name: "p", kind: "triggered", timing: "upkeep", target: "self", steps: [{ node: false, id: "may-pay", args: { mana: "{4}" } }, { node: false, id: "untap", args: {} }] };
const vaultDraw: NodeData = { name: "d", kind: "triggered", timing: "draw-step", target: "you", condition: { id: "is-tapped", args: {} }, steps: [{ node: false, id: "deal-damage", args: { amount: "1" } }] };
const vaultMana: NodeData = { name: "m", kind: "activated", timing: "anytime", cost: [{ id: "tap-self", args: {} }], steps: [{ node: false, id: "add-mana", args: { mana: "{C}{C}{C}" } }] };
for (const lang of ["ja", "en"] as const) {
  setLang(lang);
  for (const n of [vaultUntap, vaultUpkeep, vaultDraw, vaultMana]) {
    assert.deepEqual(validate(n, none, hasCard), [], `${lang} ${n.name}`);
    assert.deepEqual(parseMd(toMd(n)), n, `${lang} ${n.name}`);
  }
}
setLang("en");
assert.ok(toMd(vaultMana).includes("timing: Any time you have priority\ncost:\n  tapSelf()\nsteps:\n  addMana(mana={C}{C}{C})\n"), toMd(vaultMana));
assert.ok(toMd(vaultUpkeep).includes("steps:\n  mayPay(mana={4})\n  untap()\n"));
setLang("ja");
// 起動型には、コストが要る (602.1)。コストは、コストの動作だけ。起動型でだけ
assert.match(validate({ ...vaultMana, cost: undefined }, none, hasCard).join(), /コスト .*が要る/);
assert.match(validate({ ...vaultMana, cost: [{ id: "draw", args: { amount: "1" } }] }, none, hasCard).join(), /コストではない/);
assert.match(validate({ ...vaultUntap, kind: "static", timing: "always", cost: [{ id: "tap-self", args: {} }] }, none, hasCard).join(), /起動型と呪文能力/);
assert.deepEqual(validate({ ...vaultMana, cost: [{ id: "tap-self", args: {} }, { id: "pay-mana", args: { mana: "{2}{R}" } }, { id: "pay-life", args: { amount: "2" } }] }, none, hasCard), [], "コストは、いくつでも");
// コストの動作を、手順に置けるのは、代替コストのタイミングだけ
assert.match(validate({ ...vaultUntap, steps: [{ node: false, id: "tap-self", args: {} }] }, none, hasCard).join(), /「コスト」の欄か、代替コストのタイミング/);
// マナ・シンボル
assert.match(validate({ ...vaultMana, steps: [{ node: false, id: "add-mana", args: { mana: "three" } }] }, none, hasCard).join(), /マナ・シンボルの並び/);
assert.deepEqual(validate({ ...vaultMana, steps: [{ node: false, id: "add-mana", args: { mana: "{W/U}{2/W}{X}{C}" } }] }, none, hasCard), [], "混成・X も、通る");
// 「支払ってもよい」の後ろが、空
assert.match(validate({ ...vaultUpkeep, steps: [vaultUpkeep.steps[0]] }, none, hasCard).join(), /支払ってもよい」の後ろ/);
// 「アンタップしない」は、常在型でだけ
assert.match(validate({ ...vaultUpkeep, steps: [{ node: false, id: "does-not-untap", args: {} }] }, none, hasCard).join(), /常在型でだけ/);

// 対象「これ自身」: クリーチャーとは限らない。前の名前 (このクリーチャー / this creature) で保存したノートも、読める
setLang("ja");
const legacy = "---\nmtg: card\n---\n# X\n\n## Abilities\n\n```node\nname: a\nkind: static\ntiming: always\ntarget: this creature\nsteps:\n  doesNotUntap()\n```\n";
assert.equal(parseMd(legacy).target, "self", "前の名前 (英語)");
assert.equal(parseMd(legacy.replace("this creature", "このクリーチャー")).target, "self", "前の名前 (日本語)");
assert.deepEqual(validate(parseMd(legacy), none, hasCard), []);

// Black Lotus: {T}, Sacrifice this artifact: Add three mana of any one color. = コストに {T} と生け贄 / 効果は、好きな 1 色のマナ 3 点
const lotus: NodeData = {
  name: "l", kind: "activated", timing: "anytime",
  cost: [{ id: "tap-self", args: {} }, { id: "sacrifice-cost", args: { what: "self" } }],
  steps: [{ node: false, id: "add-mana-any-color", args: { amount: "3" } }],
};
for (const lang of ["ja", "en"] as const) {
  setLang(lang);
  assert.deepEqual(validate(lotus, none, hasCard), [], lang);
  assert.deepEqual(parseMd(toMd(lotus)), lotus, lang);
}
setLang("en");
assert.ok(toMd(lotus).includes("cost:\n  tapSelf()\n  sacrificeCost(what=self)\nsteps:\n  addManaOfAnyOneColor(amount=3)\n"), toMd(lotus));
setLang("ja");
assert.deepEqual(validate({ ...lotus, cost: [{ id: "sacrifice-cost", args: { what: "creature", count: "2" } }] }, none, hasCard), [], "「クリーチャー 2 体を生け贄に捧げる」(コスト)");
assert.match(validate({ ...lotus, cost: [{ id: "sacrifice-cost", args: { what: "moon" } }] }, none, hasCard).join(), /何を は .* のどれか/);
// 生け贄は、効果としても使える (チャンドラ) が、コストの動作 (sacrificeCost) は、手順に置けない
assert.match(validate({ ...lotus, steps: [{ node: false, id: "sacrifice-cost", args: { what: "self" } }] }, none, hasCard).join(), /「コスト」の欄か、代替コストのタイミング/);

// Oko の +2: 対象のアーティファクトかクリーチャーは、すべての能力を失い、緑の 3/3 の大鹿・クリーチャーになる = 登録してある大鹿トークンのカードを指す変身
const elkCards = new Map([["Elk Token (3-3 G)", true], ["Lightning Bolt", false]]);
const hasElk = (n: string, f?: string) => elkCards.has(n) && (f !== "token" || elkCards.get(n) === true);
const okoPlus2: NodeData = {
  name: "+2: …", kind: "activated", timing: "loyalty", loyalty: "+2", target: "target-object",
  targetArgs: { controller: "any", zone: "battlefield", type: "artifact|creature", color: "any" },
  steps: [{ node: false, id: "become-token", args: { token: "Elk Token (3-3 G)", duration: "indefinite" } }],
};
for (const lang of ["ja", "en"] as const) {
  setLang(lang);
  assert.deepEqual(validate(okoPlus2, none, hasElk), [], lang);
  assert.deepEqual(parseMd(toMd(okoPlus2)), okoPlus2, lang);
}
setLang("en");
assert.ok(toMd(okoPlus2).includes("steps:\n  becomeToken(token=Elk Token (3-3 G), duration=indefinite)\n"), toMd(okoPlus2));
setLang("ja");
assert.match(validate({ ...okoPlus2, steps: [{ node: false, id: "become-token", args: { token: "Lightning Bolt", duration: "indefinite" } }] }, none, hasElk).join(), /登録されていない/, "トークンでないカードには、なれない");
assert.match(validate({ ...okoPlus2, steps: [{ node: false, id: "become-token", args: { token: "", duration: "indefinite" } }] }, none, hasElk).join(), /トークン が無い/, "何になるか、未選択");
assert.match(validate({ ...okoPlus2, steps: [{ node: false, id: "become-token", args: { token: "Elk Token (3-3 G)", duration: "forever" } }] }, none, hasElk).join(), /期間 は .* のどれか/);

// Oko の −5: あなたがコントロールしていてアーティファクトやクリーチャーである 1 つを対象とし、対戦相手がコントロールしていてパワーが 3 以下であるクリーチャー 1 体を対象とする。それらのコントロールを交換する = 対象が 2 つ
const okoMinus5: NodeData = {
  name: "-5: …", kind: "activated", timing: "loyalty", loyalty: "-5", target: "target-object",
  targetArgs: { controller: "you", zone: "battlefield", type: "artifact|creature", color: "any" },
  alsoTargets: [{ id: "target-object", args: { controller: "opponent", zone: "battlefield", type: "creature", color: "any", "power-max": "3" } }],
  steps: [{ node: false, id: "exchange-control", args: {} }],
};
for (const lang of ["ja", "en"] as const) {
  setLang(lang);
  assert.deepEqual(validate(okoMinus5, none, hasCard), [], lang);
  assert.deepEqual(parseMd(toMd(okoMinus5)), okoMinus5, lang);
}
setLang("en");
assert.ok(toMd(okoMinus5).includes("also-target:\n  targetObject(controller=opponent, zone=battlefield, type=creature, color=any, power-max=3)\nsteps:\n  exchangeControl()\n"), toMd(okoMinus5));
setLang("ja");
assert.match(validate({ ...okoMinus5, alsoTargets: undefined }, none, hasCard).join(), /対象が 2 つ要る/, "交換には、対象が 2 つ");
assert.match(validate({ ...okoMinus5, target: undefined }, none, hasCard).join(), /最初の対象が要る/);
assert.match(validate({ ...okoMinus5, alsoTargets: [{ id: "self", args: {} }] }, none, hasCard).join(), /対象を取るもの.*だけ/, "「これ自身」は、対象を取らない");
assert.match(validate({ ...okoMinus5, alsoTargets: [{ id: "target-object", args: { controller: "opponent", type: "creature", color: "any", "power-max": "x" } }] }, none, hasCard).join(), /整数/, "もう1つの対象の引数も、検証する");
assert.deepEqual(validate({ ...okoMinus5, alsoTargets: [{ id: "target-creature", args: {} }, { id: "target-player", args: {} }] }, none, hasCard), [], "3 つ以上の対象も、書ける");
// 対象を取らない「各〜」にも、パワーの上限
assert.deepEqual(validate({ ...chandraCounters, targetArgs: { controller: "you", type: "creature", color: "any", "power-max": "2" } }, none, hasCard), []);

// カードの枠の時代 (プレビューのフォント): 主な版の発売日で、旧枠 (〜2003-07-27)・8 版枠 (2003-07-28〜2014-07-17)・新枠 (2014-07-18〜)
assert.equal(eraOf("1993-08-05"), "old");
assert.equal(eraOf("2003-07-27"), "old");
assert.equal(eraOf(EIGHTH_EDITION), "eighth", "第 8 版から、8 版枠");
assert.equal(eraOf("2014-07-17"), "eighth");
assert.equal(eraOf(MAGIC_2015), "modern", "基本セット 2015 から、新枠");
assert.equal(eraOf("2026-04-24"), "modern");
assert.equal(eraOf(undefined), "modern", "版が分からないときは、新枠");
assert.equal(frameEra({ scryfall: "b", prints: [{ id: "a", set: "lea", number: "1", released: "1993-08-05", art: "x" }, { id: "b", set: "m10", number: "2", released: "2009-07-17", art: "y" }] }), "eighth", "主な版 (card.scryfall) の発売日");
assert.equal(frameEra({ scryfall: "z", prints: [] }), "modern");
assert.equal(frameEra({}), "modern");

// 自分で置いたフォント (プラグインのフォルダの fonts/): ファイル名から、登録する名前
{
  const { familiesFor, weightFor, styleFor, FONT_EXT } = await import("../src/fonts");
  assert.deepEqual(familiesFor("Beleren2016-Bold.ttf"), ["Beleren2016-Bold", "Beleren2016", "Beleren", "JaceBeleren"], "beleren を含めば、Beleren の名前でも、登録する");
  assert.deepEqual(familiesFor("MagicMedieval.otf"), ["MagicMedieval"]);
  assert.deepEqual(familiesFor("Planewalker.woff2"), ["Planewalker"]);
  assert.deepEqual(familiesFor("Other Font.ttf"), ["Other Font"], "知らない名前は、ファイル名のまま");
  assert.equal(weightFor("Beleren-Bold.ttf"), "700");
  // 実際に置かれたファイル名 (Planewalker の 4 つの字体と、記号のフォント)
  assert.deepEqual(familiesFor("Magicmedieval-pRV1.ttf"), ["Magicmedieval-pRV1", "MagicMedieval"], "大文字小文字を問わず、MagicMedieval");
  assert.ok(familiesFor("PlanewalkerBold-xZj5.ttf").includes("Planewalker") && weightFor("PlanewalkerBold-xZj5.ttf") === "700" && styleFor("PlanewalkerBold-xZj5.ttf") === "normal");
  assert.ok(familiesFor("PlanewalkerBoldItalic-p4qr.ttf").includes("Planewalker") && weightFor("PlanewalkerBoldItalic-p4qr.ttf") === "700" && styleFor("PlanewalkerBoldItalic-p4qr.ttf") === "italic");
  assert.equal(styleFor("PlanewalkerItalic-DgM1.ttf"), "italic");
  assert.equal(styleFor("Planewalker-38m6.ttf"), "normal");
  assert.ok(!familiesFor("Planewalker Dings.otf").includes("Planewalker"), "記号のフォント (Dings) は、本文の Planewalker にしない");
  assert.equal(weightFor("Beleren.ttf"), "400");
  assert.ok(FONT_EXT.test("a.TTF") && FONT_EXT.test("a.woff2") && !FONT_EXT.test("a.exe") && !FONT_EXT.test("a.js"), "フォントのファイルだけ");
}

// カードの枠 (組み込みの CSS の枠): 色・種類のキー
{
  const { colorsOf, layerKeyFor, frameKinds, loyaltyBadge } = await import("../src/frames");
  assert.deepEqual(colorsOf({ name: "x", mana: "{3}{U}{U}" }), ["U"]);
  assert.deepEqual(colorsOf({ name: "x", mana: "{G}{W}{B}" }), ["W", "B", "G"], "WUBRG の順");
  assert.deepEqual(colorsOf({ name: "x", mana: "{W/U}{2/R}{G/P}" }), ["W", "U", "R", "G"], "混成・フィレクシア");
  assert.deepEqual(colorsOf({ name: "Elf Token (2-2 BG)", token: true }), ["B", "G"], "トークンは、名前の色から");
  assert.deepEqual(colorsOf({ name: "x", mana: "{X}{C}" }), [], "無色");
  assert.equal(layerKeyFor({ name: "x", mana: "{R}", typeLine: "Instant" }), "R");
  assert.equal(layerKeyFor({ name: "x", mana: "{R}{G}", typeLine: "Creature" }), "M");
  assert.equal(layerKeyFor({ name: "x", mana: "{4}", typeLine: "Artifact" }), "A");
  assert.equal(layerKeyFor({ name: "x", typeLine: "Land" }), "L");
  assert.equal(layerKeyFor({ name: "x", mana: "{3}", typeLine: "Artifact Creature — Golem" }), "A");
  assert.equal(layerKeyFor({ name: "x", mana: "{2}", typeLine: "Creature" }), "C");
  // 伝説・プレインズウォーカーの枠 (組み込みの CSS)
  assert.deepEqual(frameKinds({ typeLine: "Legendary Creature — Human Wizard" }), { legendary: true, planeswalker: false });
  assert.deepEqual(frameKinds({ typeLine: "Legendary Planeswalker — Chandra" }), { legendary: true, planeswalker: true });
  assert.deepEqual(frameKinds({ typeLine: "Planeswalker — Jace" }), { legendary: false, planeswalker: true });
  assert.deepEqual(frameKinds({ typeLine: "Creature — Elf", typeLineJa: "クリーチャー — エルフ" }), { legendary: false, planeswalker: false });
  assert.deepEqual(frameKinds({ typeLineJa: "伝説のプレインズウォーカー — チャンドラ" }), { legendary: true, planeswalker: true }, "日本語のタイプ行でも");
  assert.deepEqual(frameKinds({ typeLine: "Legendary Artifact — Equipment" }), { legendary: true, planeswalker: false });
  assert.deepEqual(frameKinds({}), { legendary: false, planeswalker: false });
  // 忠誠度のコストの印
  assert.deepEqual(loyaltyBadge("+2"), { text: "+2", kind: "plus" });
  assert.deepEqual(loyaltyBadge("2"), { text: "+2", kind: "plus" });
  assert.deepEqual(loyaltyBadge("0"), { text: "0", kind: "zero" });
  assert.deepEqual(loyaltyBadge("-5"), { text: "\u22125", kind: "minus" }, "マイナスは U+2212");
  assert.deepEqual(loyaltyBadge("\u22122"), { text: "\u22122", kind: "minus" });
  assert.deepEqual(loyaltyBadge("X"), { text: "X", kind: "zero" }, "数でないものは、そのまま");
}

// Ruling report: 組めていないものの収集・番号の読み取り・報告書
{
  const { collect, rulesFrom, reportMd, ruleWithSubs, isKeywordOnly } = require("../src/ruling");
  assert.equal(isKeywordOnly("Flying, vigilance"), true);
  assert.equal(isKeywordOnly("Flying, protection from spells that are one or more colors"), false);
  assert.equal(isKeywordOnly("Partner with Sam"), false);
  assert.equal(ruleWithSubs({ "701.24": "Shuffle", "701.24a": "A", "701.24b": "B", "701.240": "x", "701.25": "y" }, "701.24"), "Shuffle\n  - 701.24a: A\n  - 701.24b: B");
  assert.equal(ruleWithSubs({}, "1.1"), undefined);
  const items = collect([{ name: "Opt", typeLine: "Instant", text: "Scry 1.\nDraw a card.", abilities: [] }, { name: "Vanilla", typeLine: "Creature", abilities: [] }] as any, () => false);
  assert.equal(items.length, 2, "ルールなしは、原文の行ごと。原文の無いカードは、対象外");
  assert.equal(items[0].line, "Scry 1.");
  assert.deepEqual(rulesFrom('```json\n{"rules": ["701.22", "603.7a", "x", "701.22"]}\n```'), ["701.22", "603.7a"]);
  assert.deepEqual(rulesFrom("not json"), []);
  assert.match(reportMd("2026-01-01", "m", 2, items, { analysis: "## 足りないノード", rules: [{ number: "701.22", text: "Scry" }, { number: "9.9" }] }), /mtg: ruling-report[\s\S]*CR 701\.22: Scry[\s\S]*CR 9\.9: \(not found\)/);
}

// Ruling report: 前回を踏まえる (変わりが無ければ、AI を呼ばない。条文は、取り直さない)
void (async () => {
  const { rulingAnalysis, itemKey } = require("../src/ruling");
  const prompts: string[] = [];
  const http = async (req: any) => { prompts.push(JSON.parse(req.body).messages[0].content); return { status: 200, json: { content: [{ type: "text", text: prompts.length % 2 ? '```json\n{"rules":["701.24","119.3"]}\n```' : "## Missing nodes" }] } }; };
  const gets: string[] = [];
  const getRule = async (n: string) => { gets.push(n); return "text " + n; };
  const mk = (card: string): any => ({ card, typeLine: "", ability: "", line: "L " + card, notes: [] });
  const base = { http, provider: "claude", model: "m", key: "k", getRule };
  const r1 = await rulingAnalysis({ ...base, items: [mk("A"), mk("B")] });
  assert.equal(prompts.length, 2);
  const state = { keys: [mk("A"), mk("B")].map(itemKey), analysis: r1.analysis, rules: r1.rules };
  const r2 = await rulingAnalysis({ ...base, items: [mk("A"), mk("B")], prev: state });
  assert.equal(prompts.length, 2, "変わりが無ければ、AI を呼ばない");
  assert.equal(r2.reused, true);
  const r3 = await rulingAnalysis({ ...base, items: [mk("A"), mk("C")], prev: state });
  assert.equal(prompts.length, 4);
  assert.equal(r3.fresh, 1);
  assert.equal(r3.gone, 1);
  assert.match(prompts[2], /already fetched[^\n]*701\.24/, "前回の条文は、取り直さない (番号を伝える)");
  assert.match(prompts[3], /Previous report body[\s\S]*Resolved since then[^\n]*\n- B: L B/);
  assert.equal(gets.filter((g) => g === "701.24").length, 1, "条文を、2 回取らない");
  assert.ok(!/CR 701\.24:/.test(prompts[3]) || /newly fetched/.test(prompts[3]), "前回までの条文を、毎回送らない (新しく取ったものだけ)");
  assert.ok(!prompts[3].includes("CR 119.3:"), "前回の条文は、プロンプトに入れない");
  const many = Array.from({ length: 45 }, (_, n) => mk("X" + n));
  const b1 = await rulingAnalysis({ ...base, items: many });
  assert.equal(b1.fresh, 20, "1 回に読むのは 20 件");
  assert.equal(b1.left, 25);
  const b2 = await rulingAnalysis({ ...base, items: many, prev: { keys: b1.keys, analysis: b1.analysis, rules: b1.rules } });
  assert.equal(b2.fresh, 20);
  assert.equal(b2.left, 5, "前回の続きから (読んだものは、読み直さない)");
  // 「未対応」の注記は、ノードが持つ (消えない警告): 注記の取り出し・md の往復・点検
  const { unsupportedOf } = require("../src/ai/compose");
  assert.equal(unsupportedOf("組みました。\n未対応: 墓地から働く能力\n- Unsupported: second"), "墓地から働く能力 / second");
  assert.equal(unsupportedOf("組みました。"), undefined);
  const { auditAbility } = require("../src/node/audit");
  const un = { name: "Draw", kind: "spell", timing: "resolves", source: "Draw a card.", unsupported: "墓地から働く能力", steps: [{ node: false, id: "draw", args: { amount: "1" } }] };
  assert.ok(auditAbility({ name: "C", abilities: [un] }, un, () => false).gaps.some((g: string) => g.includes("墓地から働く能力")), "注記は、抜けの疑いとして、残る");
  assert.deepEqual(auditAbility({ name: "C", abilities: [un] }, { ...un, unsupported: undefined }, () => false).gaps, []);
  const { parseAbility: pa, abilityBlock: ab2 } = require("../src/node/card");
  assert.equal(pa(ab2(un, true).replace(/^```mtg-node\n/, "").replace(/```$/, "")).unsupported, "墓地から働く能力", "md に書いて、読み戻せる");
  assert.notEqual(itemKey({ card: "C", typeLine: "", ability: "A", line: "l", notes: ["a"] }), itemKey({ card: "C", typeLine: "", ability: "A", line: "l", notes: ["b"] }), "注記が変われば、別のもの (調べ直す)");
  console.log("ruling incremental ok");
})();

// 紋章のカード (114.1): Scryfall の layout=emblem → emblem: true。ノートに書いて、読み戻せる
{
  const em = fromScryfall({ object: "card", id: "e1", name: "Vraska, Golgari Queen Emblem", layout: "emblem", type_line: "Emblem", oracle_text: "Whenever a creature you control deals combat damage to a player, that player loses the game." } as any);
  assert.equal(em.emblem, true);
  assert.equal(parseCardMd(toCardMd(em)).emblem, true);
  assert.equal(parseCardMd(toCardMd({ name: "X", abilities: [] })).emblem, undefined, "紋章でないカードに、emblem は付かない");
  assert.match(buildQuery("", { colors: [], type: "emblem" }), /t:emblem/);
  const pt = fromScryfall({ object: "card", id: "p1", name: "Bear", type_line: "Creature — Bear", power: "2", toughness: "*" } as any);
  assert.deepEqual([pt.power, pt.toughness], ["2", "*"]);
  const back = parseCardMd(toCardMd(pt));
  assert.deepEqual([back.power, back.toughness], ["2", "*"], "パワー・タフネスは、ノートに書いて、読み戻せる");
  assert.equal(fromScryfall({ object: "card", id: "p2", name: "Bolt", type_line: "Instant" } as any).power, undefined);
}

// source-ja: 能力ごとの日本語の文 (対戦で、日本語設定なら、これを出す)
{
  const { candidates: cands, abilityText, fillSourceJa, mergeCandidates: merge } = require("../src/node/split");
  const { auditAbility } = require("../src/node/audit");
  const base = { name: "Firebird", keywords: ["Flying", "Haste"], text: "Flying, haste\nThis creature attacks each combat if able.\nLandfall — Whenever a land you control enters.", abilities: [] as any[] };
  const aligned = { ...base, textJa: "飛行、速攻\n毎ターン、可能なら攻撃する。\n上陸 ― 土地が出るたび。" };
  for (const lang of ["en", "ja"] as const) {
    const cs = cands(aligned, lang);
    assert.deepEqual(cs.map((x: any) => x.node.sourceJa), ["飛行", "速攻", "毎ターン、可能なら攻撃する。", "上陸 ― 土地が出るたび。"], `${lang}: 言語の設定に関わらず、source-ja が入る`);
  }
  assert.equal(cands({ ...base, textJa: "飛行、速攻毎ターン、可能なら攻撃する。上陸 ― 土地が出るたび。" }, "ja").every((x: any) => x.node.sourceJa === undefined), true, "行の数が合わなければ、割り当てない (手で直す)");
  const cs = cands(aligned, "en");
  assert.equal(merge([cs[2], cs[3]]).sourceJa, "毎ターン、可能なら攻撃する。\n上陸 ― 土地が出るたび。", "合体: 行ごとの日本語が、改行でつながる");
  const ab = { ...cs[2].node, kind: "static", timing: "always", steps: [] } as any;
  delete ab.sourceJa;
  const card = { ...aligned, abilities: [ab] };
  assert.equal(fillSourceJa(card), true, "あとから、足せる");
  assert.equal(card.abilities[0].sourceJa, "毎ターン、可能なら攻撃する。");
  assert.equal(abilityText(card.abilities[0], "ja"), "毎ターン、可能なら攻撃する。");
  assert.equal(abilityText(card.abilities[0], "en"), "This creature attacks each combat if able.");
  assert.equal(abilityText({ ...ab, sourceJa: undefined }, "ja"), "This creature attacks each combat if able.", "日本語が無ければ、英語");
  // md の往復 (1 行・複数行)
  const one = { name: "x", kind: "static", timing: "always", source: "A", sourceJa: "あ", steps: [{ node: false, id: "must-attack", args: {} }] } as any;
  const two = { ...one, source: "A\nB", sourceJa: "あ\nい" };
  for (const n of [one, two]) assert.deepEqual(parseMd(toMd(n)), n, "source-ja は、md に書いて、読み戻せる");
  assert.ok(!abilityBlock(one, true).includes("source-ja"), "AI への手引き (ids) には、入れない");
  // 点検: 日本語の原文があるのに、割り当てが無い
  const noJa = { ...ab, sourceJa: undefined };
  assert.ok(auditAbility({ ...aligned, abilities: [noJa] }, noJa, () => false).gaps.some((g: string) => /source-ja/.test(g)));
  assert.ok(!auditAbility({ ...base, abilities: [noJa] }, noJa, () => false).gaps.some((g: string) => /source-ja/.test(g)), "日本語の原文が無いカードは、数えない");
}

console.log("node ok");
