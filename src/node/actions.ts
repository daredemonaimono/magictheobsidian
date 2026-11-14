import { Label } from "../i18n";
import { byCr } from "./cr";
import { COLOR_CHOICES, Callable, Choice, ParamDef, choice } from "./params";
import { KEYWORDS } from "./slots";

export type { Choice, ParamDef };

// 動作 (コードで固定) と条件。ノードは、これらを組んで作る。id は言語に依らない。
export interface Def extends Callable {
  cost?: boolean; // コストの動作 (起動型の「コスト」の欄・代替コストの手順に使う)
  fn: string; // 割り振られた関数の名前 (中身は、エンジンで作る)。md の手順は、この名前の呼び出しで書く
  cr: string;
  help: Label;
}

// キーワードの選択肢。multi で複数選ぶと、それぞれのキーワードが、別々に扱われる (条件と効果が、同じキーワードどうしで対応する)
const KW_CHOICES = KEYWORDS.map((k) => ({ id: k.id, label: k.label }));
const INDEFINITE = choice("indefinite", "ずっと (期間の指定なし: ゲームの終わりまで)", "indefinitely"); // 611.2a: 期間が書かれていなければ、ゲームの終わりまで
const THIS_TURN = [choice("this-turn", "このターン", "this turn")]; // 期間 (611.2a: 解決で生まれた継続的効果は、書かれた期間だけ続く)
const L = (ja: string, en: string): Label => ({ ja, en });
const C = choice;
const COLORS = COLOR_CHOICES;

export const ACTIONS: Def[] = [
  {
    id: "modify-pt",
    fn: "modifyPT",
    label: L("修整を与える", "Modify power/toughness"),
    cr: "613.4c",
    help: L("パワー・タフネスを変える (カウンターではない。期間が終わると戻る)", "Change power/toughness (not counters; reverts when the duration ends)"),
    params: [
      { id: "power", label: L("パワー", "Power"), type: "number", default: "0" },
      { id: "toughness", label: L("タフネス", "Toughness"), type: "number", default: "0" },
      { id: "duration", label: L("期間", "Duration"), type: "choice", choices: [C("until-eot", "ターン終了時まで", "until end of turn"), C("while-applies", "このノードが適用される間", "while this node applies")], default: "until-eot" },
    ],
  },
  {
    id: "add-counter",
    fn: "addCounter",
    label: L("カウンターを置く", "Put counters"),
    cr: "122.1",
    help: L("カウンター (残り続ける) を置く", "Put counters (they stay)"),
    params: [
      { id: "kind", label: L("種類", "Kind"), type: "choice", choices: [C("plus1", "+1/+1", "+1/+1"), C("minus1", "-1/-1", "-1/-1"), C("loyalty", "忠誠", "loyalty"), C("other", "その他", "other")], default: "plus1" },
      { id: "amount", label: L("数", "Amount"), type: "number", default: "1" },
    ],
  },
  {
    id: "deal-damage",
    fn: "dealDamage",
    label: L("ダメージを与える", "Deal damage"),
    cr: "120.3",
    help: L("ダメージを与える", "Deal damage"),
    params: [
      { id: "amount", label: L("量", "Amount"), type: "number", default: "1" },
    ],
  },
  { id: "draw",
    fn: "draw", label: L("カードを引く", "Draw cards"), cr: "121.1", help: L("ライブラリーの一番上から引く", "Draw from the top of the library"), params: [{ id: "amount", label: L("数", "Amount"), type: "number", default: "1" }] },
  {
    id: "grant-keyword",
    fn: "grantKeyword",
    label: L("キーワード能力を与える", "Grant a keyword ability"),
    cr: "613.1f",
    help: L("対象にキーワード能力を与える", "Give the target a keyword ability"),
    params: [{ id: "keyword", label: L("キーワード", "Keyword"), type: "multi", choices: KW_CHOICES, default: "flying" }],
  },
  {
    id: "all-creature-types",
    fn: "setAllCreatureTypes",
    label: L("すべてのクリーチャー・タイプを持つ", "Be every creature type"),
    cr: "702.73a",
    help: L("このオブジェクトは、すべてのクリーチャー・タイプである (特性を定義する能力。戦場以外の領域でも働く: 604.3)", "This object is every creature type (a characteristic-defining ability; works in every zone: 604.3)"),
    only: ["static", "keyword"],
    params: [],
  },
  {
    id: "block-requirement",
    fn: "blockRequirement",
    label: L("ブロックの条件を課す", "Set a blocking requirement"),
    cr: "509.1b",
    help: L("このクリーチャーをブロックできる条件 (威迫: 2体以上)", "A condition on blocking this creature (menace: two or more)"),
    only: ["static", "keyword"],
    params: [{ id: "min-blockers", label: L("最少のブロッカー数", "Minimum blockers"), type: "number", default: "2" }],
  },
  // コスト (代替コスト・起動コストの手順に使う)
  {
    id: "pay-life",
    cost: true,
    fn: "payLife",
    label: L("ライフを支払う", "Pay life"),
    cr: "119.4",
    help: L("ライフを支払う (コスト。ライフが、その点数以上のときだけ、支払える)", "Pay life (a cost; only if your life total is at least that much)"),
    params: [{ id: "amount", label: L("点数", "Amount"), type: "number", default: "1" }],
  },
  {
    id: "exile-from-hand",
    cost: true,
    fn: "exileFromHand",
    label: L("手札のカードを追放する", "Exile cards from your hand"),
    cr: "701.13",
    help: L("手札から、指定の色のカードを、指定の枚数、追放する (コスト)", "Exile a number of cards of a given color from your hand (a cost)"),
    params: [
      { id: "count", label: L("枚数", "Count"), type: "number", default: "1" },
      { id: "color", label: L("色", "Color"), type: "choice", choices: COLORS, default: "any" },
    ],
  },
  {
    id: "create-token",
    fn: "createToken",
    label: L("トークンを生成する", "Create tokens"),
    cr: "701.7a",
    help: L("登録してあるトークンのカード (Cards/) を指して、その数だけ、戦場に出す。生成したプレイヤーが、コントローラーになる", "Create tokens from a registered token card (Cards/) and put them onto the battlefield; you control them"),
    params: [
      { id: "count", label: L("数", "Count"), type: "number", default: "1" },
      { id: "token", label: L("トークン", "Token"), type: "card", filter: "token", default: "" },
    ],
  },
  {
    id: "delayed-trigger",
    fn: "delay",
    label: L("ここから先の手順を、あとで行う (遅延誘発)", "Do the following steps later (delayed trigger)"),
    cr: "603.7",
    help: L("この手順より後ろの手順は、指定のタイミングに、1 回だけ行う (遅延誘発能力。解決中に作られ、次にそのタイミングが来たときだけ誘発する: 603.7a・603.7b)", "The steps after this one are done once, at the given time (a delayed triggered ability, created during resolution; it triggers only the next time: 603.7a, 603.7b)"),
    params: [{ id: "when", label: L("タイミング", "When"), type: "choice", choices: [C("upkeep", "次のアップキープの開始時", "the beginning of the next upkeep"), C("combat-begin", "次の戦闘の開始時", "the beginning of the next combat"), C("end-step", "次の終了ステップの開始時", "the beginning of the next end step")], default: "end-step" }],
  },
  {
    id: "sacrifice",
    fn: "sacrifice",
    label: L("生け贄に捧げる", "Sacrifice"),
    cr: "701.21a",
    help: L("戦場から、持ち主の墓地に置く。自分がコントロールする、戦場のパーマネントだけを、生け贄に捧げられる。何を捧げるかは、対象の欄で選ぶ", "Move it from the battlefield to its owner's graveyard. Only a permanent you control. What is sacrificed is chosen in the target slot"),
    params: [],
  },
  {
    id: "tap-self",
    cost: true,
    fn: "tapSelf",
    label: L("このパーマネントをタップする ({T})", "Tap this permanent ({T})"),
    cr: "107.5",
    help: L("コストの {T}: このパーマネントを、タップする (すでにタップ状態なら、払えない)", "The {T} in a cost: tap this permanent (can't be paid if it's already tapped)"),
    params: [],
  },
  {
    id: "pay-mana",
    cost: true,
    fn: "payMana",
    label: L("マナを支払う", "Pay mana"),
    cr: "107.4",
    help: L("マナ・コストを支払う (マナ・シンボルの並び: {2}{R} など)", "Pay a mana cost (mana symbols like {2}{R})"),
    params: [{ id: "mana", label: L("マナ", "Mana"), type: "mana", default: "{1}" }],
  },
  {
    id: "add-mana",
    fn: "addMana",
    label: L("マナを加える", "Add mana"),
    cr: "106.4",
    help: L("マナを、マナ・プールに加える (マナ・シンボルの並び: {C}{C}{C} など)", "Add mana to your mana pool (mana symbols like {C}{C}{C})"),
    params: [{ id: "mana", label: L("マナ", "Mana"), type: "mana", default: "{C}" }],
  },
  {
    id: "sacrifice-cost",
    cost: true,
    fn: "sacrificeCost",
    label: L("生け贄に捧げる (コスト)", "Sacrifice (cost)"),
    cr: "701.21a",
    help: L("コストとして、自分がコントロールするパーマネントを、生け贄に捧げる (これ自身、または、指定のタイプのパーマネントを、枚数分)", "Sacrifice permanents you control as a cost (this one, or permanents of a given type)"),
    params: [
      { id: "what", label: L("何を", "What"), type: "choice", choices: [C("self", "これ自身", "this object"), C("permanent", "パーマネント", "a permanent"), C("creature", "クリーチャー", "a creature"), C("artifact", "アーティファクト", "an artifact"), C("enchantment", "エンチャント", "an enchantment"), C("land", "土地", "a land")], default: "self" },
      { id: "count", label: L("数 (これ自身のときは、不要)", "Count (not needed for itself)"), type: "number", optional: true, default: "" },
    ],
  },
  {
    id: "add-mana-any-color",
    fn: "addManaOfAnyOneColor",
    label: L("好きな 1 色のマナを加える", "Add mana of any one color"),
    cr: "106.4",
    help: L("好きな 1 色を選んで、その色のマナを、指定の数だけ、加える (「any one color」。色を選ぶのは、解決のとき)", "Choose one color and add that many mana of it (\"any one color\")"),
    params: [{ id: "amount", label: L("数", "Amount"), type: "number", default: "1" }],
  },
  {
    id: "may-pay",
    fn: "mayPay",
    label: L("支払ってもよい。そうしたなら、ここから先の手順を行う", "You may pay. If you do, do the following steps"),
    cr: "118.12",
    help: L("マナを支払ってもよい。支払ったなら、これより後ろの手順を、行う (支払わなければ、後ろは、行わない)", "You may pay the mana. If you do, do the steps after this one (if you don't, they are skipped)"),
    params: [{ id: "mana", label: L("マナ", "Mana"), type: "mana", default: "{1}" }],
  },
  {
    id: "untap",
    fn: "untap",
    label: L("アンタップする", "Untap"),
    cr: "701.26b",
    help: L("対象をアンタップする (タップ状態のものだけ)", "Untap the target (only tapped permanents can be untapped)"),
    params: [],
  },
  {
    id: "does-not-untap",
    fn: "doesNotUntap",
    label: L("アンタップ・ステップに、アンタップしない", "Doesn't untap during your untap step"),
    cr: "502.3",
    help: L("アンタップ・ステップに、アンタップするパーマネントを決めるとき、これは、アンタップしない (常に働く)", "When you determine which permanents untap during your untap step, this one doesn't"),
    only: ["static"],
    params: [],
  },
  {
    id: "exchange-control",
    fn: "exchangeControl",
    label: L("コントロールを交換する", "Exchange control"),
    cr: "701.12b",
    help: L("対象と、もう1つの対象の、コントロールを交換する (異なるプレイヤーがコントロールしていれば、互いに、相手のものを得る。交換を、すべて完了できなければ、何も起こらない: 701.12a・701.12b)。対象が 2 つ要る", "Exchange control of the target and the other target (701.12a, 701.12b). Needs two targets"),
    params: [],
  },
  {
    id: "become-token",
    fn: "becomeToken",
    label: L("トークンのカードの特性になる (変身)", "Becomes the characteristics of a token card"),
    cr: "613.1",
    help: L("対象は、登録してあるトークンのカード (Cards/) と同じ、タイプ・色・基本のパワーとタフネス・能力になる。元の能力は、すべて失う (層の規則で、重ねて決まる: 613.1d タイプ・613.1e 色・613.1f 能力・613.4b パワー/タフネスの設定)。例: 「すべての能力を失い、緑の 3/3 の大鹿・クリーチャーになる」", "The target becomes the type, color, base power/toughness and abilities of a registered token card, losing all its other abilities (applied in layers: 613.1d type, 613.1e color, 613.1f abilities, 613.4b power/toughness setting)"),
    params: [
      { id: "token", label: L("トークン", "Token"), type: "card", filter: "token", default: "" },
      { id: "duration", label: L("期間", "Duration"), type: "choice", choices: [INDEFINITE, ...THIS_TURN], default: "indefinite" },
    ],
  },
  {
    id: "may-cast",
    fn: "mayCast",
    label: L("唱えてもよい", "You may cast it"),
    cr: "601.3",
    help: L("対象 (いまある領域のカード) を、期間のあいだ、唱えてもよい (許可を与える効果。唱えるための他のルールは、そのまま)", "You may cast the target (from where it is) for the duration (other casting rules still apply)"),
    params: [{ id: "duration", label: L("期間", "Duration"), type: "choice", choices: THIS_TURN, default: "this-turn" }],
  },
  {
    id: "exile-instead-of-graveyard",
    fn: "exileInsteadOfGraveyard",
    label: L("墓地に置かれるなら、代わりに追放する", "If it would be put into a graveyard, exile it instead"),
    cr: "614.1a",
    help: L("対象が、期間のあいだ、墓地に置かれるなら、代わりに追放する (解決中に作られる置換効果。置き換えた出来事は、起こらない: 614.6)", "If the target would be put into a graveyard during the duration, exile it instead (a replacement effect created on resolution; the replaced event never happens: 614.6)"),
    params: [{ id: "duration", label: L("期間", "Duration"), type: "choice", choices: THIS_TURN, default: "this-turn" }],
  },
  {
    id: "counter",
    fn: "counter",
    label: L("打ち消す", "Counter"),
    cr: "701.6a",
    help: L("対象 (呪文・起動型能力・誘発型能力) を打ち消す。解決されず、呪文は持ち主の墓地に置かれる。何を打ち消すかは、対象の欄で選ぶ", "Counter the target (a spell, or an activated or triggered ability). It doesn't resolve; a spell goes to its owner's graveyard. What gets countered is chosen in the target slot"),
    params: [],
  },
  {
    id: "max-blockers",
    fn: "setMaxBlockers",
    label: L("ブロックの上限を課す", "Set a blocker limit"),
    cr: "509.1b",
    help: L("このクリーチャーをブロックできるクリーチャーの数の上限 (突進するサイ: 1体まで。「2体以上によってはブロックされない」)", "The most creatures that can block this creature (e.g. 'can't be blocked by more than one creature': 1)"),
    only: ["static", "keyword"],
    params: [{ id: "max-blockers", label: L("最大のブロッカー数", "Maximum blockers"), type: "number", default: "1" }],
  },
  // ---- Ruling report (2026-11-14) から。条文は、ローカルの CR で確かめた
  {
    id: "gain-life",
    fn: "gainLife",
    label: L("ライフを得る", "Gain life"),
    cr: "119.3",
    help: L("プレイヤー (既定: あなた) が、ライフを得る。ライフ総量が、その分だけ増える", "A player (default: you) gains life; the life total goes up by that much"),
    params: [{ id: "amount", label: L("点数", "Amount"), type: "number", default: "1" }],
  },
  {
    id: "lose-life",
    fn: "loseLife",
    label: L("ライフを失う", "Lose life"),
    cr: "119.3",
    help: L("プレイヤーが、ライフを失う (支払う = コストの「ライフを支払う」とは別)", "A player loses life (not the same as paying life, which is a cost)"),
    params: [{ id: "amount", label: L("点数", "Amount"), type: "number", default: "1" }],
  },
  {
    id: "destroy",
    fn: "destroy",
    label: L("破壊する", "Destroy"),
    cr: "701.8a",
    help: L("パーマネントを、戦場から、持ち主の墓地に置く。何を破壊するかは、対象の欄で選ぶ", "Move a permanent from the battlefield to its owner's graveyard. What to destroy is chosen in the target field"),
    params: [],
  },
  {
    id: "move-zone",
    fn: "moveZone",
    label: L("領域を移す", "Move to a zone"),
    cr: "400.7",
    help: L("対象 (または、これ自身) を、別の領域へ移す。移ったものは、以前とは無関係の、新しいオブジェクトになる (400.7)。手札・追放は、持ち主の領域", "Move the target (or this object) to another zone. It becomes a new object (400.7). Hand and library are the owner's"),
    params: [{ id: "to", label: L("移し先", "To"), type: "choice", choices: [C("hand", "手札", "hand"), C("battlefield", "戦場", "the battlefield"), C("graveyard", "墓地", "graveyard"), C("exile", "追放領域", "exile"), C("library-top", "ライブラリーの一番上", "top of the library"), C("library-bottom", "ライブラリーの一番下", "bottom of the library"), C("library-owner-choice", "ライブラリーの一番上か一番下 (持ち主が選ぶ)", "top or bottom of the library (the owner's choice)")], default: "hand" }],
  },
  {
    id: "shuffle",
    fn: "shuffle",
    label: L("ライブラリーを切り直す", "Shuffle a library"),
    cr: "701.24a",
    help: L("ライブラリーのカードを、順番が誰にも分からないよう、ランダムにする。「ライブラリーに加えて切り直す」は、領域を移す → 切り直す (701.24c)", "Randomize a library. \"Shuffle it into a library\" = move to the library, then shuffle (701.24c)"),
    params: [{ id: "whose", label: L("誰のライブラリー", "Whose library"), type: "choice", choices: [C("you", "あなた", "yours"), C("owner", "対象の持ち主", "the target's owner")], default: "you" }],
  },
  {
    id: "may-do",
    fn: "mayDo",
    label: L("してもよい。そうしたなら、ここから先の手順を行う", "You may. If you do, do the following steps"),
    cr: "118.12",
    help: L("次の手順は、行ってもよい。行ったなら、その後ろの手順を行う (行わなければ、後ろは行わない)。マナを支払う場合は、「支払ってもよい」", "The next step is optional. If you do it, do the steps after it (if you don't, they are skipped). For paying mana, use \"may pay\""),
    params: [],
  },
  {
    id: "lose-game",
    fn: "loseGame",
    label: L("ゲームに敗北する", "Lose the game"),
    cr: "104.3e",
    help: L("プレイヤー (対象の欄) が、ゲームに敗北する", "A player (the target field) loses the game"),
    params: [],
  },
  {
    id: "extra-turn",
    fn: "extraTurn",
    label: L("追加のターンを得る", "Take extra turns"),
    cr: "500.7",
    help: L("このターンの直後に、追加のターンを、指定の数だけ加える (追加のターンは、1 つずつ加わる)", "Add extra turns directly after this turn (they are added one at a time)"),
    params: [{ id: "count", label: L("数", "Count"), type: "number", default: "1" }],
  },
  {
    id: "copy-spell",
    fn: "copySpell",
    label: L("呪文をコピーする", "Copy a spell"),
    cr: "707.10",
    help: L("呪文 (または能力) のコピーを、スタックに置く (唱えたことには、ならない)。新しい対象を選んでもよい (707.10c)", "Put a copy of a spell (or ability) onto the stack; it isn't cast. New targets may be chosen (707.10c)"),
    params: [{ id: "new-targets", label: L("対象", "Targets"), type: "choice", choices: [C("may-choose", "新しい対象を選んでもよい", "may choose new targets"), C("keep", "そのまま", "keep the same")], default: "may-choose" }],
  },
  {
    id: "may-play-land",
    fn: "mayPlayLand",
    label: L("土地をプレイしてもよい", "You may play lands"),
    cr: "305.1",
    help: L("対象の領域 (墓地など) の土地を、期間のあいだ、プレイしてもよい (許可を与える効果。土地のプレイは、特別な処理で、スタックを使わない。プレイできる回数などの他のルールは、そのまま)", "You may play lands from the target zone for the duration (playing a land is a special action; other land-play rules still apply)"),
    params: [{ id: "duration", label: L("期間", "Duration"), type: "choice", choices: THIS_TURN, default: "this-turn" }],
  },
  {
    id: "sacrifice-by",
    fn: "sacrificeBy",
    label: L("プレイヤーに、生け贄に捧げさせる", "A player sacrifices"),
    cr: "701.21a",
    help: L("指定のプレイヤーが、自分のコントロールするパーマネントを、指定の数、生け贄に捧げる (何を捧げるかは、そのプレイヤーが選ぶ)", "The chosen player sacrifices permanents they control (that player chooses which)"),
    params: [
      { id: "who", label: L("誰が", "Who"), type: "choice", choices: [C("defending-player", "防御プレイヤー", "the defending player"), C("target-player", "対象のプレイヤー", "target player"), C("each-opponent", "各対戦相手", "each opponent"), C("each-player", "各プレイヤー", "each player")], default: "target-player" },
      { id: "count", label: L("数", "Count"), type: "number", default: "1" },
      { id: "what", label: L("何を", "What"), type: "choice", choices: [C("permanent", "パーマネント", "permanents"), C("creature", "クリーチャー", "creatures"), C("artifact", "アーティファクト", "artifacts"), C("enchantment", "エンチャント", "enchantments"), C("land", "土地", "lands")], default: "permanent" },
    ],
  },
  {
    id: "must-attack",
    fn: "mustAttack",
    label: L("毎戦闘、可能なら攻撃する", "Attacks each combat if able"),
    cr: "508.1d",
    help: L("攻撃クリーチャーの指定のとき、攻撃しなければならない (可能なら)。「攻撃する要求」の 1 つ", "Must attack if able when attackers are declared (an attack requirement)"),
    only: ["static", "keyword"],
    params: [],
  },
  {
    id: "cant-be-countered",
    fn: "cantBeCountered",
    label: L("打ち消されない", "Can't be countered"),
    cr: "113.6g",
    help: L("このオブジェクトは、打ち消されない (スタックの上で働く能力。「できない」は、「できる」に優先する: 101.2)", "This object can't be countered (functions on the stack; 'can't' beats 'can': 101.2)"),
    only: ["static", "keyword"],
    params: [],
  },
  {
    id: "ring-tempts",
    fn: "ringTempts",
    label: L("指輪があなたを誘惑する", "The Ring tempts you"),
    cr: "701.54a",
    help: L("あなたのクリーチャー 1 体を、指輪所持者にする (「指輪」の紋章を、持っていなければ、得る: 701.54c)", "Choose a creature you control as your Ring-bearer (get the emblem named The Ring first if you don't have it: 701.54c)"),
    params: [],
  },
];

export const CONDITIONS: Def[] = [
  {
    id: "controls-power-at-least",
    fn: "controlsPowerAtLeast",
    label: L("パワーがN以上のクリーチャーをコントロールしている", "You control a creature with power N or greater"),
    cr: "109.4",
    help: L("自分のコントロールするクリーチャーに、パワーが N 以上のものがある", "You control a creature whose power is at least N"),
    params: [{ id: "n", label: L("N", "N"), type: "number", default: "4" }],
  },
  {
    id: "graveyard-has-keyword-creature",
    fn: "graveyardHasCreatureWithKeyword",
    label: L("墓地に、そのキーワードを持つクリーチャー・カードがある", "A creature card with the keyword is in a graveyard"),
    cr: "404.1",
    help: L("いずれかの墓地に、そのキーワード能力を持つクリーチャー・カードがある。複数選ぶと、キーワードごとに別々に判定する (効果の同じキーワードに対応)", "A creature card with that keyword is in any graveyard. With several, each is checked separately (paired with the same keyword in the effect)"),
    params: [{ id: "keyword", label: L("キーワード", "Keyword"), type: "multi", choices: KW_CHOICES, default: "flying" }],
  },
  {
    id: "is-tapped",
    fn: "isTapped",
    label: L("このパーマネントが、タップ状態である", "This permanent is tapped"),
    cr: "110.5",
    help: L("このパーマネントのステータスが、タップ状態である (誘発型では、「〜なら」: 誘発したときと、解決するときに、確かめる: 603.4)", "This permanent's status is tapped (on a triggered ability: an intervening 'if', checked on trigger and on resolution: 603.4)"),
    params: [],
  },
  {
    id: "gained-life-at-least",
    fn: "gainedLifeAtLeast",
    label: L("このターン、ライフを N 点以上得ている", "You gained N or more life this turn"),
    cr: "119.3",
    help: L("このターンに、あなたが得たライフの合計が N 以上 (ターンごとの記録が要る。誘発型では、「〜なら」: 603.4)", "You gained at least N life this turn (needs a per-turn record; on a triggered ability, an intervening 'if': 603.4)"),
    params: [{ id: "n", label: L("N", "N"), type: "number", default: "3" }],
  },
  {
    id: "is-ring-bearer",
    fn: "isRingBearer",
    label: L("これが、あなたの指輪所持者である", "This is your Ring-bearer"),
    cr: "701.54e",
    help: L("このクリーチャーが、あなたのコントロール下で戦場にいて、指輪所持者の指定を持っている", "This creature is on the battlefield under your control and has the Ring-bearer designation"),
    params: [],
  },
  {
    id: "ring-tempted-at-least",
    fn: "ringTemptedAtLeast",
    label: L("指輪が、このゲームで N 回以上、あなたを誘惑している", "The Ring has tempted you N or more times this game"),
    cr: "701.54c",
    help: L("このゲームで、指輪があなたを誘惑した回数が N 以上 (「指輪」の紋章の能力は、その回数で決まる)", "The Ring has tempted you at least N times this game (the Ring emblem's abilities depend on this count)"),
    params: [{ id: "n", label: L("N", "N"), type: "number", default: "2" }],
  },
  { id: "my-turn",
    fn: "isMyTurn", label: L("自分のターン", "It's your turn"), cr: "500.1", help: L("自分のターンである", "It is your turn"), params: [] },
];

// 動作・条件は、CR の番号順 (作った順ではない)
ACTIONS.sort(byCr);
CONDITIONS.sort(byCr);

export const actionOf = (id: string) => ACTIONS.find((a) => a.id === id);
export const conditionOf = (id: string) => CONDITIONS.find((c) => c.id === id);
