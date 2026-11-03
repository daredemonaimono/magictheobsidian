// 効果の型・ルールのカタログ (どこまで実装されているか、どう実装されているか)。
// ここが唯一の元データで、Bot/Types/ の md は、ここから書き出した「読むためのビュー」。
// 型を足す・実装を変えたら、ここを直す (md は、プラグインの更新時に書き直される)。
// status: implemented = 実装済み / partial = 一部だけ / planned = まだ (要望を受けて作る)

export type Status = "implemented" | "partial" | "planned";
export const CATEGORIES = ["能力の種類", "命令", "何を(選び方)", "どれだけ", "条件", "きっかけ", "コスト", "キーワード", "ゲームのルール", "未実装"] as const;
export type Category = (typeof CATEGORIES)[number];

// ノートのタイトル (ファイル名) とフォルダ名は英語。日本語の名前は ja に持つ (aliases に入るので、日本語でも検索できる)
export const CATEGORY_EN: Record<Category, string> = {
  能力の種類: "Ability kinds", 命令: "Instructions", "何を(選び方)": "Selectors", どれだけ: "Amounts", 条件: "Conditions", きっかけ: "Triggers", コスト: "Costs", キーワード: "Keywords", ゲームのルール: "Game rules", 未実装: "Not implemented",
};

export const EN_TITLES: Record<string, string> = {
  "kind.spell": "Spell effect", "kind.activated": "Activated ability", "kind.mana": "Mana ability", "kind.ref": "Shared ability (ref)", "kind.static": "Static ability", "kind.altCost": "Alternative cost", "kind.suspend": "Suspend", "verb.copy": "copy", "verb.create": "create", "verb.counters": "counters (verb)", "verb.addType": "addType", "kind.triggered": "Triggered ability",
  "verb.move": "move", "verb.change": "change", "verb.addMana": "addMana", "verb.use": "use", "verb.shuffle": "shuffle", "verb.flip": "flip", "verb.if": "if", "verb.may": "may", "verb.unsupported": "unsupported",
  "sel.cards": "cards", "sel.player": "player", "sel.any": "any", "sel.ref": "ref", "sel.targets": "targets",
  "amount.number": "number", "amount.of": "of", "amount.count": "count", "amount.x": "X",
  "cond.cmp": "cmp", "cond.has": "has", "cond.did": "did",
  "event.upkeep": "upkeep", "event.etb": "etb", "event.dies": "dies", "event.more": "More triggers",
  "cost.tap": "tap", "cost.mana": "mana", "cost.life": "life", "cost.sacrificeSelf": "sacrificeSelf", "cost.more": "More costs",
  "kw.landwalk": "landwalk", "kw.more": "More keywords",
  "rule.turn": "Turn and steps", "rule.priority": "Priority and stack", "rule.mana": "Mana pool", "rule.land": "Land drop", "rule.sick": "Summoning sickness", "rule.stack": "Targets and fizzle",
  "rule.opening": "Dice and mulligan", "rule.hand": "Hand size", "rule.combat": "Combat damage", "rule.state": "State-based actions", "rule.random": "Randomness and replay", "rule.tapland": "Enters tapped",
  "todo.token": "Tokens", "todo.counter": "Counters", "todo.static": "Static effects", "todo.duration": "Duration effects", "todo.replace": "Replacement effects", "todo.altcost": "Alternative and additional costs",
  "todo.counterspell": "Counterspells", "todo.control": "Control and copy", "todo.attach": "Auras and equipment", "todo.pw": "Planeswalkers", "todo.faces": "Multi-face cards", "todo.history": "Turn history", "todo.spent": "Mana spent tracking", "todo.judge": "Judge mode",
};

export const titleOf = (e: TypeEntry) => (e.id.startsWith("kw.") && !EN_TITLES[e.id] ? e.id.slice(3) : (EN_TITLES[e.id] ?? e.id));

export interface TypeEntry {
  id: string; // 例: verb.move
  category: Category;
  title: string;
  status: Status;
  since?: string; // 入った版
  summary: string; // 何か
  shape?: string; // JSON の書き方
  impl?: string; // どう実装されているか (コードのどこで、どう動くか)
  limits?: string; // 制限・未対応
  example?: string; // 例 (カード名)
}

const J = (o: unknown) => JSON.stringify(o);

export const TYPE_ENTRIES: TypeEntry[] = [
  // ---- 能力の種類 ----
  { id: "kind.spell", category: "能力の種類", title: "呪文の効果", status: "implemented", since: "0.27.0", summary: "インスタント・ソーサリーを唱えて解決したときの効果。", shape: J({ kind: "spell", targets: [], effects: [] }), impl: "engine.ts の resolveTop()。スタックから取り出し、対象がまだ有効か確かめて、効果 (命令の並び) を runSteps() で実行し、墓地へ送る。記録が無い呪文は、墓地へ行くだけ (ログに「効果は未実装」)。", limits: "対象のうち1つだけ消えたときは、残りだけ実行する (全部消えたら不発)。", example: "Thoughtseize, Swords to Plowshares" },
  { id: "kind.activated", category: "能力の種類", title: "起動型能力", status: "implemented", since: "0.27.0", summary: "コストを払って起動する能力。スタックを使う。", shape: J({ kind: "activated", cost: { tap: true }, targets: [], effects: [] }), impl: "engine.ts の actions() が、優先権のあるときの行動に「起動」を並べ (コストを払えて、対象を選べるときだけ)、perform() が、対象を選び → コストを払い → スタックに載せる。解決は resolveTop()。", limits: "「ソーサリーのタイミングだけ」「ターンに1回」の制限は、まだ無い。", example: "Wasteland, Marsh Flats" },
  { id: "kind.mana", category: "能力の種類", title: "マナ能力", status: "implemented", since: "0.27.0", summary: "マナを出す能力。スタックを使わず、すぐ解決する。", shape: J({ kind: "mana", cost: { tap: true }, effects: [{ do: "addMana", options: "C", n: 2 }] }), impl: "コストがタップだけのものは、自動の支払い (planPayment) で使われる。手動のプレイヤー (人) は、タップしてマナプールに出す (行動 tapMana)。生け贄などの追加コストがあるものは、「起動」の行動になり、解決もすぐ行う。", limits: "痛み (Caves of Koilos の1点) や条件つきのマナは、まだ無い。", example: "Mana Crypt, Black Lotus" },
  { id: "kind.ref", category: "能力の種類", title: "ref (共有の能力)", status: "implemented", since: "0.38.0", summary: "能力ライブラリの共有の能力を、引数をつけて使う。カードの記録の中に {\"ref\":\"能力のid\",\"args\":{...}} と書く。", shape: J({ ref: "etbDraw", args: { n: 2 } }), impl: "abilities.ts の expandRefs() が、記録を読み込むときに、能力の処理 (引数は \"$n\") に引数を入れて展開する。エンジンは、展開後の能力だけを実行する。処理が無い (未処理の) 能力は、「未対応」の印になり、ログとボットには、動かない部分として出る。能力が補完されると、その能力を使うカードは、すぐ動く。エンジンが動かすキーワードの ref は、何も足さない (カードの keywords で動く)。", limits: "1つの能力につき、能力 (kind) は1つ。複数の文からなる呪文は、1つの能力にまとめる。" },
  { id: "kind.static", category: "能力の種類", title: "常在型能力", status: "partial", since: "0.35.0", summary: "戦場にある間、ずっと働く能力。いまは「起動の禁止」だけ。", shape: J({ kind: "static", restrictions: [{ type: "cantActivate", what: { kind: "cards", types: ["artifact"] } }], effects: [] }), impl: "engine.ts の activationBlocked()。場のすべてのパーマネントの常在型能力を調べ、起動型能力・マナ能力を持つパーマネントが、what に合うかを判定する。禁止されると、行動の一覧 (actions) に「起動」「マナを出す」が出ず、マナの自動の支払い (payment) の候補からも外れる。出どころが戦場を離れれば、すぐ止まる (判定は、そのたびに場を見て行う)。", limits: "「起動の禁止」だけ。パワー・タフネスの修整、コストの増減、キーワードの付与、攻撃・ブロックの制限は未実装 (todo.static)。誘発型能力・忠誠度能力は禁止されない。", example: "Null Rod, Collector Ouphe" },
  { id: "kind.altCost", category: "能力の種類", title: "代替コスト", status: "partial", since: "0.37.0", summary: "マナコストの代わりに払うコストで、呪文を唱えられる。生け贄、手札から追放、ライフ、別のマナコストを組み合わせられ、自分のターンかどうかの条件もつけられる。evoke: true にすると想起 (Evoke): この唱え方で出たパーマネントは、出たとき生け贄になる。", shape: J({ kind: "altCost", alt: { sacrifice: { sel: { kind: "cards", types: ["land"], subtypes: ["Mountain"] }, n: 2 }, exileFromHand: { sel: { kind: "cards", colors: ["B"] }, n: 1 }, life: 1, mana: "{R}", evoke: true, unless: "notYourTurn" }, effects: [] }), impl: "engine.ts の actions() が、払える代替コストごとに、唱える行動 (cast の alt = 能力の番号) を並べる (altPayable)。perform() は、対象を選んだあと payAlt() で、生け贄にするもの・追放する手札を選び (selectCards)、ライフとマナを払う。呪文の効果は、別の spell 能力に書く。", limits: "追加コスト (Kicker など)、墓地などから唱えるもの (Flashback) は未実装。想起で出たパーマネントの生け贄の誘発は、自身の出たときの能力より先に積まれる (解決は後。順番は選べない)。", example: "Fireblast" },
  { id: "kind.suspend", category: "能力の種類", title: "待機", status: "implemented", since: "0.37.0", summary: "手札から待機コストを払って追放し、時間カウンターを置く。自分のアップキープに1つ取り除き、最後の1つを取り除いたとき、マナコストを払わずに唱えてもよい。", shape: J({ kind: "suspend", suspend: { n: 1, cost: "{R}" }, effects: [] }), impl: "engine.ts の actions() (手札の待機の行動)、perform() (追放して Card.time に数を置く)、suspendTick() (アップキープの開始時に減らし、0 になったら唱えるかを聞く。対象はこのとき選ぶ)。", limits: "スタックに載らず、すぐ処理する (優先権のやりとりが無い)。クリーチャーを待機で唱えたときの速攻は未実装。", example: "Rift Bolt" },
  { id: "kind.triggered", category: "能力の種類", title: "誘発型能力", status: "partial", since: "0.27.0", summary: "出来事が起きたときに、自動でスタックに載る能力。", shape: J({ kind: "triggered", trigger: { event: "upkeep", whose: "you" }, optional: false, effects: [] }), impl: "engine.ts の fire(event) が、場のカードの誘発型能力を探して、スタックに積む (ターンプレイヤーの能力を先に積む)。対象は解決時に選ぶ。", limits: "きっかけは3種類だけ (下の「きっかけ」)。対象を、積むときではなく解決時に選ぶ (簡略)。", example: "Mana Crypt, Orcish Bowmasters" },

  // ---- 命令 ----
  { id: "verb.move", category: "命令", title: "move (移す)", status: "implemented", since: "0.31.0", summary: "カードをゾーンからゾーンへ移す。ドロー、捨てる、破壊、追放、手札に戻す、ミル、サーチ、蘇生、戦場に出す、はすべてこれ。", shape: J({ do: "move", what: { kind: "cards", zone: "hand", owner: "opponent", count: 1, chooser: "you" }, to: "graveyard", how: "discard", position: "top", as: "x" }), impl: "engine.ts の move()。what をカードの選び方 (selectCards) で実際のカードにして、元のゾーンから抜き、行き先に置く。how=draw は draw() を呼ぶ (山札が足りないと負ける)。how=destroy は破壊不能を見て、破壊されない。戦場から墓地へ行くと「死亡」の誘発 (fire dies)、戦場へ出ると「出たとき」の誘発とタップ状態の判定 (enter)。as で名前をつけると、移したカードの姿 (パワーなど) を、あとの命令から参照できる。", limits: "戦場から離れるときの置換効果 (「代わりに追放」) は無い。「戦場から手札へ」は、トークンが消える処理が無い (トークン自体が未実装)。", example: "Thoughtseize (捨てる), Swords (追放), Marsh Flats (サーチ)" },
  { id: "verb.change", category: "命令", title: "change (変える)", status: "partial", since: "0.31.0", summary: "ライフとダメージを変える。", shape: J({ do: "change", what: { kind: "player", who: "you" }, stat: "life", delta: -2 }), impl: "engine.ts の change()。stat=life は増減、stat=damage は与えるダメージ (プレイヤーにはライフ減、クリーチャーには damage を載せる)。delta は数か、「そのパワー」「数える」などの Amount。", limits: "カウンターの増減、パワー・タフネスの修整は未実装。呪文・能力のダメージには、接死・絆魂が働かない (戦闘ダメージだけ働く)。", example: "Mana Crypt (3点), Thoughtseize (2点失う)" },
  { id: "verb.addMana", category: "命令", title: "addMana (マナを出す)", status: "implemented", since: "0.27.0", summary: "マナプールにマナを足す。", shape: J({ do: "addMana", options: "WUBRG", n: 3 }), impl: "engine.ts の runSteps()。options が複数の色なら、1度だけ色を選び (choice)、n 個足す。マナプールはステップの終わりに空になる。", limits: "「このマナは〜にしか使えない」の制限、マナ変換は無い。", example: "Dark Ritual, Black Lotus" },
  { id: "verb.shuffle", category: "命令", title: "shuffle (シャッフル)", status: "implemented", since: "0.31.0", summary: "山札をシャッフルする。", shape: J({ do: "shuffle", owner: "you" }), impl: "engine.ts の shuffle()。seed つきの乱数 (対戦ごとに決まる) を使うので、リプレイで同じ結果になる。", example: "Marsh Flats" },
  { id: "verb.flip", category: "命令", title: "flip (コイン投げ)", status: "implemented", since: "0.27.0", summary: "コインを投げて、勝ち・負けで別の命令を実行する。", shape: J({ do: "flip", win: [], lose: [] }), impl: "engine.ts の runSteps()。seed つきの乱数で決める (リプレイで同じ結果)。", example: "Mana Crypt" },
  { id: "verb.if", category: "命令", title: "if (もし〜なら)", status: "implemented", since: "0.31.0", summary: "条件で、実行する命令を分ける。", shape: J({ do: "if", cond: { has: { kind: "cards", types: ["land"], owner: "you" } }, then: [], else: [] }), impl: "engine.ts の runSteps() が evalCond() で条件を調べて、then か else を実行する。", example: "(今のデッキには無い)" },
  { id: "verb.may", category: "命令", title: "may (してもよい)", status: "implemented", since: "0.31.0", summary: "「してもよい」。決める人に、する・しないを聞く。", shape: J({ do: "may", steps: [], who: "you" }), impl: "engine.ts の runSteps()。choose() で「する/しない」を選ばせる。誘発型能力の optional も、解決時に同じ形で聞く。" },
  { id: "verb.use", category: "命令", title: "use (マクロ)", status: "implemented", since: "0.34.0", summary: "マクロ (命令の組み合わせに、名前をつけた部品) を使う。記録を読むとき、命令の並びに展開される。", shape: J({ do: "use", macro: "discardLose", args: { n: 1, life: -2 } }), impl: "effects.ts の expandSteps()。マクロの steps の中の \"$名前\" を引数に置き換え、入れ子 (flip / if / may の中、マクロの中のマクロ。5段まで) も展開する。エンジンは、展開後の命令だけを実行する。マクロは、ルールブックの隠しフォルダ (rulebook/macros/) に保存され、「処理を書く」で AI が作る。見つからないマクロは、未対応になる。", limits: "マクロの中に、未対応 (unsupported) は入れられない。" },
  { id: "verb.copy", category: "命令", title: "copy (コピー)", status: "implemented", since: "0.37.0", summary: "スタックの呪文 (self = いま解決している呪文) のコピーを作る。コピーは、元の呪文より先に解決され、解決したら消える (墓地へは行かない)。", shape: J({ do: "copy", what: { kind: "ref", ref: "t" }, by: { kind: "player", who: "you" }, newTargets: true, color: "R" }), impl: "engine.ts の copySpell()。スタックの上に、コピーの項目 (copy: true) を積む。by = コピーを持つ人 (既定は能力のコントローラー)。newTargets = 持つ人が、新しい対象を選んでもよい (選ばなければ、同じ対象のまま)。color = コピーの色 (CardDef.colors)。対象にする呪文は、zone を stack にして選ぶ。", limits: "コピーできるのは、スタックの呪文だけ。パーマネントのコピー (クローン)、能力のコピーは未実装。", example: "Fork, Chain Lightning" },
  { id: "verb.create", category: "命令", title: "create (トークンを作る)", status: "implemented", since: "0.39.0", summary: "トークンを n 体作る。コントローラーの戦場に出る。トークンは、戦場を離れたら消える (墓地などには行かない)。as で名前をつけると、あとの命令が「いま作ったもの」を指せる。", shape: J({ do: "create", token: { name: "Zombie Army", types: "Creature — Zombie Army", power: 0, toughness: 0, colors: ["B"], keywords: [] }, n: 1, as: "token" }), impl: "engine.ts の createTokens()。トークンのカード定義 (makeDef) を作って enter() で戦場に出す (token: true)。出たときの誘発は enter() が拾う。", limits: "トークンの能力 (誘発・起動) は書けない。コピーのトークン、タップ状態や攻撃状態で出るもの、相手のコントロール下に作るものは未実装。", example: "Orcish Bowmasters (Amass)" },
  { id: "verb.counters", category: "命令", title: "counters (カウンターを置く)", status: "partial", since: "0.39.0", summary: "戦場のパーマネントにカウンターを n 個置く。+1/+1 カウンターは、パワーとタフネスに足される。選び方に合うものが複数なら、コントローラーが選ぶ。", shape: J({ do: "counters", what: { kind: "cards", subtypes: ["Army"], owner: "you", count: 1 }, counter: "+1/+1", n: 1, as: "army" }), impl: "engine.ts の putCounters()。Perm.counters に数を持ち、refresh() が、元の姿 (Perm.base) から、今のパワー・タフネス (Perm.def) を作り直す。戦場を離れると base に戻る。", limits: "カウンターを取り除く・動かす、-1/-1 カウンターとの相殺、+1/+1 以外のカウンターに意味を持たせること (忠誠度、時間以外) は未実装。" },
  { id: "verb.addType", category: "命令", title: "addType (サブタイプを加える)", status: "implemented", since: "0.39.0", summary: "戦場のパーマネントに、サブタイプを加える (すでに持っていれば何もしない)。選び方・参照 (as の名前) で指す。", shape: J({ do: "addType", what: { kind: "ref", ref: "army" }, subtype: "Orc" }), impl: "engine.ts の runSteps()。Perm.addedTypes に足し、refresh() でタイプ行を作り直す。", limits: "ずっと続く変更 (戦場を離れるまで)。「ターン終了まで」の期間つきは未実装。" },
  { id: "verb.unsupported", category: "命令", title: "unsupported (未対応)", status: "implemented", since: "0.27.0", summary: "エンジンが実行できない文の印。実行されず、ログに「未対応の効果」と出る。", shape: J({ do: "unsupported", text: "原文" }), impl: "effects.ts の sanitize が、知らない命令・壊れた形を、これに置き換える。能力の残りは動く。「未実装の効果」の一覧の元になる。" },

  // ---- 何を ----
  { id: "sel.cards", category: "何を(選び方)", title: "cards (カード)", status: "implemented", since: "0.31.0", summary: "条件に合うカードを選ぶ。", shape: J({ kind: "cards", zone: "hand", owner: "opponent", types: ["creature"], subtypes: ["Plains"], supertypes: ["legendary"], not: ["land"], name: "Plains", cmc: { op: "<=", n: 3 }, power: { op: ">=", n: 4 }, count: 1, upTo: false, chooser: "you", top: false }), impl: "engine.ts の candidates() が、ゾーンと持ち主で候補を集め、matches() が、タイプ・サブタイプ・基本/伝説・除外・名前・マナ総量・パワーで絞る。selectCards() が、枚数ぶん選ぶ (全部入るなら聞かない)。chooser が選ぶ人 (既定はコントローラー)。top=true は山札の上から (選ばない)。", limits: "色、タップ状態、攻撃中、持つキーワード、「そのターンに出た」での絞り込みは未実装。" },
  { id: "sel.player", category: "何を(選び方)", title: "player (プレイヤー)", status: "implemented", since: "0.31.0", summary: "プレイヤーを選ぶ (自分・相手・各・あるカードのコントローラー)。", shape: J({ kind: "player", who: "controllerOf", ref: "x" }), impl: "engine.ts の playersOf()。controllerOf は、参照したカードの、その時点のコントローラー。" },
  { id: "sel.any", category: "何を(選び方)", title: "any (いずれか1つ)", status: "implemented", since: "0.31.0", summary: "クリーチャー・プレインズウォーカー・プレイヤーのいずれか1つ (「any target」)。", shape: J({ kind: "any" }), impl: "engine.ts の targetCandidates()。クリーチャーとプレインズウォーカーの場のカード (呪禁・被覆でないもの) と、2人のプレイヤーを候補にする。", limits: "プレインズウォーカーが未実装なので、実際には、クリーチャーとプレイヤー。", example: "Orcish Bowmasters" },
  { id: "sel.ref", category: "何を(選び方)", title: "ref (参照)", status: "implemented", since: "0.31.0", summary: "名前をつけた対象 (targets の id) か、前の命令の結果 (as) を指す。", shape: J({ kind: "ref", ref: "t" }), impl: "engine.ts の resolveWhat()。対象はいまの場所 (消えていたら何もしない)、結果は、その時点の姿 (snap) を持つので、追放後のパワーも参照できる。" },
  { id: "sel.targets", category: "何を(選び方)", title: "targets (対象の宣言)", status: "partial", since: "0.31.0", summary: "唱える・起動するときに、対象を選ぶ。解決時に、まだ有効か確かめ、全部無効なら不発。", shape: J({ targets: [{ id: "t", sel: { kind: "cards", types: ["creature"] } }] }), impl: "engine.ts の declareTargets() (選ぶ)、targetsAvailable() (対象が無ければ唱えられない)、targetLegal() (解決時の確認)。呪禁・被覆は canTarget() で見る。", limits: "誘発型能力の対象は、解決時に選ぶ (本来は積むとき)。対象の変更・コピーは無い。" },

  // ---- どれだけ ----
  { id: "amount.number", category: "どれだけ", title: "数", status: "implemented", since: "0.31.0", summary: "固定の数。", shape: "3", impl: "evalAmount()。" },
  { id: "amount.of", category: "どれだけ", title: "of (そのカードの値)", status: "implemented", since: "0.31.0", summary: "参照したカードのパワー・タフネス・マナ総量。", shape: J({ of: "power", ref: "x" }), impl: "engine.ts の evalAmount()。追放などで消えたカードも、その時点の姿 (snap) から読む。", example: "Swords to Plowshares" },
  { id: "amount.count", category: "どれだけ", title: "count (数える)", status: "implemented", since: "0.31.0", summary: "条件に合うカードの数。", shape: J({ count: { kind: "cards", types: ["land"], owner: "you" } }), impl: "engine.ts の evalAmount() が candidates() の件数を使う。" },
  { id: "amount.x", category: "どれだけ", title: "X", status: "planned", summary: "X コストの呪文の X。", limits: "X は0として扱われる。" },

  // ---- 条件 ----
  { id: "cond.cmp", category: "条件", title: "cmp (数の比較)", status: "implemented", since: "0.31.0", summary: "2つの数を比べる。", shape: J({ cmp: [3, ">=", { count: { kind: "cards", types: ["land"] } }] }), impl: "engine.ts の evalCond()。" },
  { id: "cond.has", category: "条件", title: "has (〜がある)", status: "implemented", since: "0.31.0", summary: "条件に合うカードが1枚でもあるか。", shape: J({ has: { kind: "cards", types: ["artifact"], owner: "you" } }), impl: "engine.ts の evalCond()。" },
  { id: "cond.did", category: "条件", title: "did (実行した)", status: "implemented", since: "0.31.0", summary: "名前 (as) をつけた命令が、1枚以上移したか。「そうしたなら」。", shape: J({ did: "x" }), impl: "engine.ts の evalCond()。結果 (results) の枚数を見る。" },

  // ---- きっかけ ----
  { id: "event.upkeep", category: "きっかけ", title: "upkeep (アップキープの開始時)", status: "implemented", since: "0.27.0", summary: "誰かのアップキープの開始時。whose = you / opponent / each。", shape: J({ event: "upkeep", whose: "you" }), impl: "engine.ts の turn() が、アップキープに入るとき fire('upkeep') を呼ぶ。コントローラーが合う能力だけ積む。", example: "Mana Crypt" },
  { id: "event.etb", category: "きっかけ", title: "etb (戦場に出たとき)", status: "implemented", since: "0.27.0", summary: "このカード自身が戦場に出たとき。", shape: J({ event: "etb" }), impl: "engine.ts の enter() が fire('etb') を呼ぶ (呪文の解決、土地を出す、効果で戦場に出る、すべて)。", limits: "他のカードが出たときの誘発は無い。", example: "Orcish Bowmasters" },
  { id: "event.dies", category: "きっかけ", title: "dies (死亡したとき)", status: "implemented", since: "0.27.0", summary: "このカード自身が戦場から墓地へ行ったとき。", shape: J({ event: "dies" }), impl: "engine.ts の checkState() (致死ダメージ) と move() (破壊・生け贄) が fire('dies') を呼ぶ。", limits: "他のカードの死亡には反応しない。" },
  { id: "event.more", category: "きっかけ", title: "他のきっかけ", status: "planned", summary: "攻撃したとき・ブロックしたとき・戦闘ダメージを与えたとき・カードを引いたとき・呪文を唱えたとき・ターン終了時・戦闘の開始時・タップされたとき・ライフを得たとき、など。", limits: "Orcish Bowmasters の「相手がカードを引くたび」が、ここに当たる。" },

  // ---- コスト ----
  { id: "cost.tap", category: "コスト", title: "tap ({T})", status: "implemented", since: "0.27.0", summary: "このカードをタップする。召喚酔いのクリーチャーは払えない。", shape: J({ tap: true }), impl: "engine.ts の usable() と actions()。" },
  { id: "cost.mana", category: "コスト", title: "mana (マナ)", status: "implemented", since: "0.27.0", summary: "マナを払う。マナプールを先に使い、足りない分は、マナ源を自動でタップする (人は、先に手動でタップしておく)。", shape: J({ mana: "{1}{W}" }), impl: "engine.ts の payment() (pool を先に使う spendPool → planPayment)。色の割り当ては、全探索に近い簡単な方法。", limits: "ファイレクシアマナは、色マナとして払う (ライフでは払わない)。X は0。ハイブリッドは、どちらの色でも払える。" },
  { id: "cost.life", category: "コスト", title: "life (ライフ)", status: "implemented", since: "0.27.0", summary: "ライフを払う。ライフが足りない (払うと0以下) ときは、起動できない。", shape: J({ life: 1 }), impl: "engine.ts の actions() と perform()。", example: "Marsh Flats" },
  { id: "cost.sacrificeSelf", category: "コスト", title: "sacrificeSelf (自分を生け贄)", status: "implemented", since: "0.27.0", summary: "このカードを生け贄にする。", shape: J({ sacrificeSelf: true }), impl: "engine.ts の perform() が、コストを払うとき、sacrifice() で墓地へ送る。", limits: "生け贄の「死亡」の誘発は、まだ起きない。", example: "Wasteland, Black Lotus" },
  { id: "cost.more", category: "コスト", title: "他のコスト", status: "partial", since: "0.39.0", impl: "想起 (Evoke) の代替コストは実装済み。kind.altCost の evoke を見る。", summary: "手札を捨てる、他のカードを生け贄、手札から色のカードを追放 (Evoke / Force)、カウンターを取り除く、他のカードをタップ、など。代替コスト・追加コスト (Kicker, Flashback)。", limits: "Grief, Solitude, Force of Despair の代替コストが、ここに当たる。" },

  // ---- キーワード ----
  { id: "kw.flying", category: "キーワード", title: "flying (飛行)", status: "implemented", since: "0.26.0", summary: "飛行か到達を持つクリーチャーにしかブロックされない。", impl: "engine.ts の canBlock()。" },
  { id: "kw.reach", category: "キーワード", title: "reach (到達)", status: "implemented", since: "0.26.0", summary: "飛行のクリーチャーをブロックできる。", impl: "engine.ts の canBlock()。" },
  { id: "kw.haste", category: "キーワード", title: "haste (速攻)", status: "implemented", since: "0.26.0", summary: "出たターンに攻撃・{T} できる。", impl: "engine.ts の usable() と declareAttackers()。" },
  { id: "kw.vigilance", category: "キーワード", title: "vigilance (警戒)", status: "implemented", since: "0.26.0", summary: "攻撃してもタップしない。", impl: "engine.ts の declareAttackers()。" },
  { id: "kw.flash", category: "キーワード", title: "flash (瞬速)", status: "implemented", since: "0.26.0", summary: "インスタントのタイミングで唱えられる。", impl: "engine.ts の actions()。" },
  { id: "kw.trample", category: "キーワード", title: "trample (トランプル)", status: "implemented", since: "0.28.0", summary: "ブロッカーに致死ダメージを割り振った残りを、プレイヤーに与える。", impl: "engine.ts の combatDamage() の割り振り。接死と組み合わせると、致死が1点になるので、残りが多くなる (テスト済み)。" },
  { id: "kw.first strike", category: "キーワード", title: "first strike (先制攻撃)", status: "implemented", since: "0.28.0", summary: "通常のダメージより先に、戦闘ダメージを与える。", impl: "engine.ts の combatDamage()。先制の回 → 通常の回の2回で、間に状況起因処理を挟む。", limits: "2回のダメージの間に、優先権のやりとりは無い。" },
  { id: "kw.double strike", category: "キーワード", title: "double strike (二段攻撃)", status: "implemented", since: "0.28.0", summary: "先制の回と通常の回の、両方でダメージを与える。", impl: "engine.ts の combatDamage()。" },
  { id: "kw.deathtouch", category: "キーワード", title: "deathtouch (接死)", status: "implemented", since: "0.28.0", summary: "1点でも与えたクリーチャーは死ぬ。トランプルの割り振りでは、致死が1点。", impl: "engine.ts の deal() が『接死の印』を付け、checkState() が死なせる。割り振りは combatDamage()。", limits: "呪文・能力のダメージには働かない。" },
  { id: "kw.lifelink", category: "キーワード", title: "lifelink (絆魂)", status: "implemented", since: "0.28.0", summary: "与えたダメージの分、ライフを得る。", impl: "engine.ts の deal()。", limits: "呪文・能力のダメージには働かない。" },
  { id: "kw.menace", category: "キーワード", title: "menace (威迫)", status: "implemented", since: "0.28.0", summary: "2体以上でないとブロックできない。", impl: "engine.ts の declareBlockers()。複数ブロックに対応。" },
  { id: "kw.defender", category: "キーワード", title: "defender (防衛)", status: "implemented", since: "0.28.0", summary: "攻撃できない。", impl: "engine.ts の declareAttackers()。" },
  { id: "kw.indestructible", category: "キーワード", title: "indestructible (破壊不能)", status: "implemented", since: "0.28.0", summary: "致死ダメージと『破壊』で死なない。", impl: "engine.ts の checkState() と move() (how=destroy)。", limits: "タフネスが0以下になる場合は、死ぬ。" },
  { id: "kw.hexproof", category: "キーワード", title: "hexproof (呪禁)", status: "implemented", since: "0.28.0", summary: "相手の呪文・能力の対象にならない。", impl: "engine.ts の canTarget()。" },
  { id: "kw.shroud", category: "キーワード", title: "shroud (被覆)", status: "implemented", since: "0.28.0", summary: "誰の呪文・能力の対象にもならない。", impl: "engine.ts の canTarget()。" },
  { id: "kw.intimidate", category: "キーワード", title: "intimidate (威嚇)", status: "implemented", since: "0.28.0", summary: "アーティファクトか、同じ色のクリーチャーにしかブロックされない。", impl: "engine.ts の canBlock()。色は、マナコストの記号から読む。", limits: "マナコストの無いカード (土地、特殊な色指定のカードなど) は、色なしとして扱う。" },
  { id: "kw.fear", category: "キーワード", title: "fear (畏怖)", status: "implemented", since: "0.28.0", summary: "アーティファクトか黒のクリーチャーにしかブロックされない。", impl: "engine.ts の canBlock()。" },
  { id: "kw.skulk", category: "キーワード", title: "skulk (忍び足)", status: "implemented", since: "0.28.0", summary: "パワーが自分より大きいクリーチャーにブロックされない。", impl: "engine.ts の canBlock()。" },
  { id: "kw.shadow", category: "キーワード", title: "shadow (影)", status: "implemented", since: "0.28.0", summary: "影を持つクリーチャーとだけ、ブロック・被ブロックができる。", impl: "engine.ts の canBlock()。" },
  { id: "kw.landwalk", category: "キーワード", title: "〜walk (土地渡り)", status: "implemented", since: "0.28.0", summary: "島・沼・山・森・平地。相手がその土地を持つとブロックされない。", impl: "engine.ts の canBlock()。", limits: "伝説の土地渡り・基本でない土地渡りは未実装。" },
  { id: "kw.more", category: "キーワード", title: "他のキーワード", status: "partial", summary: "protection, ward, infect, wither, evoke, kicker, flashback, cycling, equip, crew, cascade, storm など (Scryfall に 200 以上ある)。", limits: "頻度の高い順に足す。評価は、Bot/Diagnostics のデッキの診断で見る。" },

  // ---- ゲームのルール ----
  { id: "rule.turn", category: "ゲームのルール", title: "ターンとステップ", status: "implemented", since: "0.26.0", summary: "アップキープ → ドロー → メイン1 → 戦闘開始 → 攻撃 → ブロック → ダメージ → 戦闘終了 → メイン2 → 終了。先攻の最初のターンは引かない。", impl: "engine.ts の turn()。攻撃クリーチャーがいなければ、宣言・ブロック・ダメージのステップは飛ばす。", limits: "追加ターン、ステップを飛ばす効果は無い。" },
  { id: "rule.priority", category: "ゲームのルール", title: "優先権とスタック", status: "implemented", since: "0.27.0", summary: "各ステップで、ターンプレイヤーから優先権を渡し合う。2人が続けてパスし、スタックが空ならステップが進む。空でなければ、一番上を解決する。", impl: "engine.ts の priorityRound()。選べる行動が無い (またはパスだけ) と、聞かずに進む。人 (手動) は、止まると決めたステップ (stops) か、スタックに何かあるときだけ聞かれる。", limits: "打ち消し (スタックの上の呪文を対象にする) が未実装。" },
  { id: "rule.mana", category: "ゲームのルール", title: "マナプール", status: "implemented", since: "0.27.0", summary: "出したマナは、そのステップの終わりに消える。呪文を唱えるとき、先にプールから払う。", impl: "engine.ts の spendPool() と turn() の step()。" },
  { id: "rule.land", category: "ゲームのルール", title: "土地は1ターン1枚", status: "implemented", since: "0.26.0", summary: "メインフェイズで、スタックが空のときだけ、1枚。", impl: "engine.ts の actions() (landDropped)。" },
  { id: "rule.sick", category: "ゲームのルール", title: "召喚酔い", status: "implemented", since: "0.26.0", summary: "出たターンの頭から支配していないクリーチャーは、攻撃・{T} できない (速攻は例外)。", impl: "engine.ts の usable() と declareAttackers()。" },
  { id: "rule.stack", category: "ゲームのルール", title: "対象の有効性と不発", status: "implemented", since: "0.31.0", summary: "対象が全部消えたら、呪文・能力は何もしない。", impl: "engine.ts の resolveTop() が targetLegal() で確かめる。" },
  { id: "rule.opening", category: "ゲームのルール", title: "ダイス・マリガン", status: "implemented", since: "0.29.0", summary: "ダイスに勝った人が先攻・後攻を選ぶ。ロンドン式マリガン (引き直して、枚数ぶんを山札の下へ)。最大6回。", impl: "engine.ts の openingHands()。" },
  { id: "rule.hand", category: "ゲームのルール", title: "手札上限 (7枚)", status: "implemented", since: "0.29.0", summary: "ターン終了時に8枚以上なら、捨てるカードを、持ち主が選ぶ。", impl: "engine.ts の cleanup() が choose() で選ばせる。" },
  { id: "rule.combat", category: "ゲームのルール", title: "戦闘のダメージ計算", status: "implemented", since: "0.28.0", summary: "ブロックの宣言 (1体を複数でブロック可) → 先制の回 → 通常の回。致死ダメージを順に割り振り (トランプルは残りをプレイヤーへ)、接死・絆魂・破壊不能を処理する。", impl: "engine.ts の declareBlockers() / canBlock() / combatDamage() / deal() / checkState()。", limits: "ダメージの割り振りの順番を、攻撃側が選ぶ処理は無い (ブロックを宣言した順)。" },
  { id: "rule.state", category: "ゲームのルール", title: "状況起因処理", status: "implemented", since: "0.26.0", summary: "致死ダメージ・タフネス0以下のクリーチャーは死ぬ。ライフ0以下か、山札切れで負ける。決着したら、勝敗を1回だけ記録する。", impl: "engine.ts の checkState()。", limits: "レジェンド・ルール、毒カウンター、プレインズウォーカーの忠誠度は未実装。" },
  { id: "rule.random", category: "ゲームのルール", title: "乱数とリプレイ", status: "implemented", since: "0.26.0", summary: "シャッフル・ダイス・コイン投げは、対戦ごとの seed から決まる。全員の答えの列を保存するので、同じ展開を再現できる。", impl: "engine.ts の rng() と history。Bot/Games のログに、seed と答えの列が入る。", limits: "リプレイの再生画面は、まだ無い。" },
  { id: "rule.tapland", category: "ゲームのルール", title: "タップ状態で出る土地", status: "partial", since: "0.29.0", summary: "条件なしで「タップ状態で出る」と書かれたものが、タップ状態で出る。", impl: "engine.ts の makeDef() が entersTapped を読み、enter() が反映する。", limits: "条件つき (ショックランド、「〜を支配していなければ」) は読まない。" },

  // ---- 未実装 (要望を受けて作る) ----
  { id: "todo.token", category: "未実装", title: "トークンの作成", status: "partial", since: "0.39.0", summary: "トークン (クリーチャーなど) を作る。", impl: "verb.create を見る。", limits: "トークンの能力、コピーのトークンは未実装。" },
  { id: "todo.counter", category: "未実装", title: "カウンター (+1/+1 など)", status: "partial", since: "0.39.0", summary: "カウンターを置く・取り除く。パワー・タフネスを計算し直す。", impl: "置くことと +1/+1 の計算は実装済み。verb.counters を見る。", limits: "取り除く、動かす、他の種類のカウンターの意味づけは未実装。" },
  { id: "todo.static", category: "未実装", title: "継続効果 (常在型能力)", status: "partial", since: "0.35.0", summary: "「〜は+1/+1」「コストが1少ない」「攻撃できない」など。場を見て、特性を計算し直す。", impl: "「起動の禁止」(Null Rod, Collector Ouphe) だけ実装済み。kind.static を見る。", limits: "パワー・タフネスの修整、キーワードの付与、コストの増減、攻撃・ブロックの制限は未実装。" },
  { id: "todo.duration", category: "未実装", title: "期間つきの効果", status: "planned", summary: "「ターン終了時まで+2/+2」など。" },
  { id: "todo.replace", category: "未実装", title: "置換効果", status: "planned", summary: "「〜するなら、代わりに〜する」。出来事に割り込む。", limits: "Leyline of the Void, Containment Priest, Dauthi Voidwalker, Mox Diamond など。" },
  { id: "todo.altcost", category: "未実装", title: "代替コスト・追加コスト", status: "partial", since: "0.37.0", summary: "Evoke、Flashback、Kicker、Convoke など。", impl: "「マナコストの代わりに払う」代替コスト (生け贄、手札から追放、ライフ、別のマナコスト、自分のターンかの条件) と、想起 (Evoke) は実装済み。kind.altCost を見る。", limits: "追加コスト (Kicker)、墓地や追放領域から唱えるもの (Flashback) は未実装。" },
  { id: "todo.counterspell", category: "未実装", title: "打ち消し", status: "planned", summary: "スタックの呪文を対象にして、打ち消す。" },
  { id: "todo.control", category: "未実装", title: "コントロール奪取・コピー", status: "partial", since: "0.37.0", summary: "Control Magic、呪文・永続物のコピー。", impl: "スタックの呪文のコピーだけ実装済み。verb.copy を見る。", limits: "コントロール奪取、パーマネントのコピーは未実装。" },
  { id: "todo.attach", category: "未実装", title: "オーラ・装備品", status: "planned", summary: "付ける、外す、「エンチャントしているクリーチャーは〜」。" },
  { id: "todo.pw", category: "未実装", title: "プレインズウォーカー", status: "planned", summary: "忠誠度、忠誠度能力、プレインズウォーカーへの攻撃。" },
  { id: "todo.faces", category: "未実装", title: "多面カード", status: "planned", summary: "両面カード、分割カード、冒険、MDFC。いまは表面だけを読む。" },
  { id: "todo.history", category: "未実装", title: "ターンの履歴", status: "planned", summary: "「このターンに出たクリーチャー」「このターンに引いた枚数」など。", limits: "Force of Despair, Orcish Bowmasters (最初の1枚を除く) など。" },
  { id: "todo.spent", category: "未実装", title: "使ったマナの記録", status: "planned", summary: "「使った色の数」(Converge) など。", limits: "Prismatic Ending など。" },
  { id: "todo.judge", category: "未実装", title: "審判モード", status: "planned", summary: "エンジンが動かせない効果を、人が盤面を手で直して処理する (カードを別のゾーンへ、ライフを直す)。" },
];

export const entryById = (id: string) => TYPE_ENTRIES.find((e) => e.id === id);

// ---- 記録 (能力) が使っている型を集める ----
import type { Ability, Amount, CardSel, Selector, Step } from "./effects";

export function collectUsage(abilities: Ability[]): Set<string> {
  const used = new Set<string>();
  const amount = (a: Amount | "all" | undefined) => {
    if (a === undefined || a === "all") return;
    if (typeof a === "number") used.add("amount.number");
    else if ("of" in a) used.add("amount.of");
    else (used.add("amount.count"), sel(a.count));
  };
  const sel = (x: Selector | CardSel) => {
    used.add(`sel.${x.kind}`);
    if (x.kind === "cards") amount(x.count);
  };
  const steps = (list: Step[]) => {
    for (const s of list) {
      used.add(`verb.${s.do}`);
      if (s.do === "move") sel(s.what);
      else if (s.do === "change") (sel(s.what), amount(s.delta));
      else if (s.do === "flip") (steps(s.win ?? []), steps(s.lose ?? []));
      else if (s.do === "if") {
        const c = s.cond;
        if ("cmp" in c) (used.add("cond.cmp"), amount(c.cmp[0]), amount(c.cmp[2]));
        else if ("has" in c) (used.add("cond.has"), sel(c.has));
        else used.add("cond.did");
        steps([...s.then, ...(s.else ?? [])]);
      } else if (s.do === "may") steps(s.steps);
    }
  };
  for (const a of abilities) {
    used.add(`kind.${a.kind}`);
    for (const k of Object.keys(a.cost ?? {})) used.add(`cost.${k}`);
    if (a.trigger) used.add(`event.${a.trigger.event}`);
    if (a.targets?.length) {
      used.add("sel.targets");
      a.targets.forEach((t) => sel(t.sel));
    }
    steps(a.effects);
  }
  return used;
}
