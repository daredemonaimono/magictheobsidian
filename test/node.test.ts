import assert from "node:assert/strict";
import { abilityLabel, candidates, hasSource, mergeCandidates } from "../src/node/split";
import { setLang } from "../src/i18n";
import { CARD_TYPES, cardTypeOf } from "../src/node/cardtypes";
import { KINDS, timingOf } from "../src/node/kinds";
import { NodeData } from "../src/node/md";
import { parseCardMd, toCardMd } from "../src/node/card";
import { artFileName, buildQuery, isScryfallImage, cardsOf, fromScryfall, printsFrom, printsUrl, scryfallUrl } from "../src/node/scryfall";
import { validate } from "../src/node/validate";

// 能力の種類は、この 5 つ (この順)
assert.deepEqual(KINDS.map((k) => k.label.ja), ["常在型", "誘発型", "起動型", "呪文能力", "キーワード能力"]);
assert.deepEqual(KINDS.map((k) => k.label.en), ["Static", "Triggered", "Activated", "Spell", "Keyword"]);

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
  assert.ok(md.includes("```node\nname: Ferocious\nkind: Triggered\ntiming: When it attacks\ncondition: controlsPowerAtLeast(n=4)\ntarget: this creature\nsteps:\n  modifyPT(power=2, toughness=2, duration=until-eot)\n```"), md);
}
setLang("ja");
// 飛行を与える常在型 (全クリーチャー) と、キーワード「飛行」
const giveFlying: NodeData = { name: "GiveFlying", kind: "static", timing: "always", target: "all-creatures", steps: [{ node: false, id: "grant-keyword", args: { keyword: "flying" } }] };
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
assert.equal(ja2.type, "creature"); // 複数のタイプは、cardtypes.ts の順で最初のもの (唱えるタイミングは、どれも同じ)
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

console.log("node ok");
