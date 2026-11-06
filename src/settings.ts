import { App, Notice, Platform, Plugin, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import { AiSettings, DEFAULT_AI, PROVIDERS, Provider, SCENES, Scene, TextProvider, providersFor } from "./battle/aiConfig";
import { CURRENCIES, updateRates } from "./prices";
import { IMAGE_MODES, ImageMode, PRELOAD_KINDS, PRELOAD_SCOPES, PreloadKind, PreloadScope } from "./imageKey";
import { cacheInfo, clearImageCache } from "./imageCache";


// Scryfall の言語コード
export const LANGS: Record<string, string> = {
  en: "English",
  ja: "日本語",
  ko: "한국어",
  zhs: "简体中文",
  zht: "繁體中文",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
  it: "Italiano",
  pt: "Português",
  ru: "Русский",
};

// クリックに組み合わせる修飾キー (shift / mod = Mac は ⌘・それ以外は Ctrl / alt = Option・Alt / ctrl)
export type ModKey = "shift" | "mod" | "alt" | "ctrl";
export const MOD_KEYS: ModKey[] = ["shift", "mod", "alt", "ctrl"];
export const modLabel = (k: ModKey): string => (k === "shift" ? "Shift" : k === "mod" ? (Platform.isMacOS ? "⌘ Command" : "Ctrl") : k === "alt" ? (Platform.isMacOS ? "⌥ Option" : "Alt") : "Ctrl");
export const hasMod = (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }, k: ModKey): boolean => (k === "shift" ? e.shiftKey : k === "alt" ? e.altKey : k === "ctrl" ? e.ctrlKey : Platform.isMacOS ? e.metaKey : e.ctrlKey);

export interface Settings {
  textLang: string; // カード名・効果テキスト
  cardLang: string; // カード画像 (収録一覧)
  listArt: boolean; // サイドバーの一覧に、カードのイラストを薄く出す
  dashboardTab: boolean; // 新しいタブ (空のタブ) をダッシュボードにする
  currency: string; // 資産価格の通貨 (EUR で取れた価格はこれに換算する)
  sidebar: boolean; // カード一覧・対戦のプレビューとログを右サイドバーに出す。オフなら画面内 (従来の表示)
  ai: AiSettings; // AI の接続 (キー) と、場面ごとの使い分け (対戦の相手・ルールを書かせる・メモの下書き)
  battleOpponent: "cpu" | "claude" | "passive"; // 対戦の相手。cpu = 雑魚 CPU / claude = AI (API を、判断のたびに呼ぶ。種類は、ai の battle) / passive = 何もしない
  battleHistory: boolean; // 対戦の履歴を Battles/ に保存する (終わったとき・途中でやめたとき)
  battleEffects: boolean; // 対戦の演出 (ダメージ・ライフの数字を大きく出す)
  keyRemove: ModKey; // デッキの一覧で、このキーを押しながらクリック = 1枚減らす (初期値 Shift)
  keyMove: ModKey; // デッキの一覧で、このキーを押しながらクリック = メインとサイドを入れ替える (初期値 ⌘ / Ctrl)
  imageMode: ImageMode; // カード画像の保存 (プラグインのフォルダの中。Vault からは参照しない)。off = 保存しない / view = 見た画像を保存 / preload = デッキ・コレクションのカードも先に保存
  imageScope: PreloadScope; // 「先に保存」の範囲。decks = デッキとコレクションのカード / all = Cards/ のカードすべて
  imageKind: PreloadKind; // 「先に保存」の種類。both = カード全体とイラスト / card = カード全体 / art = イラストだけ
  battleNoMirror: boolean; // 対戦の相手を「ランダム」にしたとき、自分と同じデッキ (ミラー) を選ばない
  battleStops: "always" | "smart"; // 対戦の優先権の止まり方。always = 毎回止まる / smart = 使えるものがあるときだけ (メインフェイズでは、必ず止まる)
}

export const DEFAULT_SETTINGS: Settings = { textLang: "en", cardLang: "en", sidebar: true, listArt: true, dashboardTab: true, currency: "USD", ai: DEFAULT_AI, keyRemove: "shift", keyMove: "mod", battleNoMirror: false, imageMode: "view", imageScope: "decks", imageKind: "both", battleStops: "smart", battleOpponent: "cpu", battleHistory: true, battleEffects: true };

// 設定の名前で、キーチェーンから取る (空・見つからないときは null)
// 設定画面の部品: 大項目 (タブ) → 中項目 (折りたたみ) → 小項目 (1つの設定を描く関数)
interface Ctx {
  el: HTMLElement; // 小項目を並べる場所 (中項目の中身)
}
interface SectionDef {
  id: string; // 中項目の id (同じ大項目の中で、重ならない)
  title: string;
  desc?: string;
  items: ((c: Ctx) => void)[];
}
interface TabDef {
  id: string; // 大項目の id
  title: string;
  sections: SectionDef[];
}

export const secretKey = (app: App, name: string): string | null => (name ? app.secretStorage.getSecret(name) : null);

export class SettingsTab extends PluginSettingTab {
  constructor(app: App, plugin: Plugin, private settings: Settings, private save: () => Promise<void>, private onSidebar: () => void, private onImages: () => void = () => {}) {
    super(app, plugin);
  }
  // ---- 設定画面の構造: 大項目 (タブ) → 中項目 (折りたたみ) → 小項目 (1つの設定)。
  // 設定を増やすときは、tabs() の、該当する中項目の items に、1つ足すだけ。中項目・大項目を増やすときも、tabs() に足すだけ (描画は layout が一括で行う)
  private static activeTab = "general";
  private static closed = new Set<string>(); // 閉じている中項目の id (タブの id/中項目の id)。ここに無ければ開いている

  private tabs(): TabDef[] {
    const ai = this.settings.ai;
    const el = (c: Ctx) => c.el;
    const lang = (c: Ctx, name: string, desc: string, key: "textLang" | "cardLang") =>
      new Setting(el(c))
        .setName(name)
        .setDesc(desc)
        .addDropdown((d) =>
          d
            .addOptions(LANGS)
            .setValue(this.settings[key])
            .onChange(async (v) => {
              this.settings[key] = v;
              await this.save();
            }),
        );
    const toggle = (c: Ctx, name: string, desc: string, key: "dashboardTab" | "sidebar" | "listArt" | "battleHistory" | "battleEffects" | "battleNoMirror", after?: () => void) =>
      new Setting(el(c))
        .setName(name)
        .setDesc(desc)
        .addToggle((t) =>
          t.setValue(this.settings[key]).onChange(async (v) => {
            this.settings[key] = v;
            await this.save();
            after?.();
          }),
        );
    const keyPick = (c: Ctx, name: string, desc: string, key: "keyRemove" | "keyMove") =>
      new Setting(el(c))
        .setName(name)
        .setDesc(desc)
        .addDropdown((d) => {
          for (const k of MOD_KEYS) d.addOption(k, `${modLabel(k)}+クリック`);
          d.setValue(this.settings[key]).onChange(async (v) => {
            const other = key === "keyRemove" ? "keyMove" : "keyRemove";
            this.settings[key] = v as ModKey;
            if (this.settings[other] === v) new Notice("削除と入れ替えに、同じキーが選ばれている。削除が優先される");
            await this.save();
          });
        });
    // 切り替えボタン (トグル式): 1つだけ選べる。選ぶと画面を出し直す
    const toggles = <T extends string>(c: Ctx, name: string, desc: string, options: [T, string][], current: T, onPick: (v: T) => Promise<void>) => {
      const st = new Setting(el(c)).setName(name).setDesc(desc);
      const row = st.controlEl.createDiv("mtg-seg");
      for (const [v, label] of options) {
        const b = row.createEl("button", { text: label, cls: v === current ? "is-on" : "" });
        b.addEventListener("click", async () => {
          await onPick(v);
          this.display();
        });
      }
    };
    const keyRow = (c: Ctx, p: Provider, name: string, desc: string) =>
      new Setting(el(c))
        .setName(name)
        .setDesc(desc)
        .addComponent((e) =>
          new SecretComponent(this.app, e).setValue(ai.keys[p]).onChange(async (id) => {
            ai.keys[p] = id ?? "";
            await this.save();
          }),
        );
    const hint: Record<Provider, string> = { claude: "例: claude-haiku-5-5(安い)/ claude-sonnet-5-5 / claude-opus-5-5 / claude-fable-5-1(強い・高い)", openai: "例: gpt-4o-mini", gemini: "例: gemini-2.5-flash", jev: "jev-latest (最新の Jev。docs.typesafe.ai の「Models」で、名前を確かめられる)" };

    return [
      {
        id: "general",
        title: "一般 / General",
        sections: [
          {
            id: "language",
            title: "言語 / Language",
            items: [
              (c) => lang(c, "効果テキストの言語 / Text language", "カード名と効果テキスト。無い言語は英語で表示。新しく取得するカードから反映。", "textLang"),
              (c) => lang(c, "カードの言語 / Card language", "カード画像とイラスト選択の言語。その言語の版が無いカードは英語になる。新しく取得するカードから反映。", "cardLang"),
            ],
          },
          {
            id: "screen",
            title: "画面 / Screen",
            items: [(c) => toggle(c, "新しいタブをダッシュボードにする / New tab is the dashboard", "新しいタブ(空のタブ)を開くと、ダッシュボードが開く。オフにすると、Obsidian 標準の新しいタブに戻る。", "dashboardTab")],
          },
          {
            id: "images",
            title: "画像 / Images",
            desc: "カードの画像は、プラグインのフォルダの中 (.obsidian/plugins/…/cache/images) に保存して、2回目からは通信せずに出す。Vault の外なので、ノートからは参照されず、検索・一覧にも出ない。マナのシンボルは、プラグインに埋め込んであり、通信しない。",
            items: [
              (c) => {
                const st = new Setting(c.el).setName("画像の保存 / Image cache").setDesc("保存しない: そのつど通信する(いちばん軽いが、オフラインでは出ない)。見た画像を保存: 画面に出た画像だけ、1枚ずつ保存する(おすすめ)。先に保存: 見た画像に加えて、デッキとコレクションのカードを、起動のあとに、まとめて保存する(最初は、通信とディスクを多く使う)。");
                const row = st.controlEl.createDiv("mtg-seg");
                for (const [v, label] of [["off", "保存しない"], ["view", "見た画像を保存"], ["preload", "先に保存"]] as [ImageMode, string][]) {
                  row.createEl("button", { text: label, cls: v === this.settings.imageMode ? "is-on" : "" }).addEventListener("click", async () => {
                    if (!IMAGE_MODES.includes(v)) return;
                    this.settings.imageMode = v;
                    await this.save();
                    this.onImages();
                    this.display();
                  });
                }
              },
              (c) => {
                const st = new Setting(c.el).setName("先に保存する範囲 / Preload scope").setDesc("「先に保存」のときと、コマンド「Save card images…」で保存するカード。デッキとコレクション: 使っているカードだけ(デッキで選んだ版も)。Cards のすべて: Cards フォルダのカードを標準の版で全部(数千枚あると、時間とディスクを使う)。");
                const row = st.controlEl.createDiv("mtg-seg");
                for (const [v, label] of [["decks", "デッキとコレクション"], ["all", "Cards のすべて"]] as [PreloadScope, string][]) {
                  row.createEl("button", { text: label, cls: v === this.settings.imageScope ? "is-on" : "" }).addEventListener("click", async () => {
                    if (!PRELOAD_SCOPES.includes(v)) return;
                    this.settings.imageScope = v;
                    await this.save();
                    this.onImages();
                    this.display();
                  });
                }
              },
              (c) => {
                const st = new Setting(c.el).setName("先に保存する画像の種類 / Preload kind").setDesc("カード全体: 大きい画像(プレビュー・対戦・デッキ画面)。イラスト: 一覧・サムネイルの小さい画像。両方がいちばん多く使うが、どの画面も通信しなくなる。");
                const row = st.controlEl.createDiv("mtg-seg");
                for (const [v, label] of [["both", "両方"], ["card", "カード全体"], ["art", "イラスト"]] as [PreloadKind, string][]) {
                  row.createEl("button", { text: label, cls: v === this.settings.imageKind ? "is-on" : "" }).addEventListener("click", async () => {
                    if (!PRELOAD_KINDS.includes(v)) return;
                    this.settings.imageKind = v;
                    await this.save();
                    this.display();
                  });
                }
              },
              (c) => {
                const st = new Setting(c.el).setName("保存した画像 / Saved images").setDesc("保存した画像の数と大きさ。消しても、次に見るときに、また保存される。");
                // 説明文 (setDesc) を、あとから非同期で書き換えない: Obsidian 1.15 の設定画面が、固まるため。大きさは、別の要素に出す
                const info = st.controlEl.createSpan({ cls: "mtg-cacheinfo", text: "調べています…" });
                void cacheInfo().then(({ files, bytes }) => info.setText(`${files} 枚 · ${(bytes / 1024 / 1024).toFixed(1)} MB`)).catch(() => info.setText("保存先を読めない"));
                st.addButton((b) =>
                  b.setButtonText("すべて消す").onClick(async () => {
                    const n = await clearImageCache();
                    new Notice(`保存した画像を消した: ${n} 枚`);
                    this.display();
                  }),
                );
              },
            ],
          },
          {
            id: "price",
            title: "価格 / Price",
            items: [
              (c) =>
                new Setting(el(c))
                  .setName("価格の通貨 / Currency")
                  .setDesc("コレクションの価格と合計の通貨。Scryfall の USD を換算して出す。USD が無いカードは、EUR の価格を換算する。為替レートは、価格の更新と、この設定を変えたときに取る。")
                  .addDropdown((d) =>
                    d
                      .addOptions(CURRENCIES)
                      .setValue(this.settings.currency)
                      .onChange(async (v) => {
                        this.settings.currency = v;
                        await this.save();
                        await updateRates().catch(() => new Notice("為替レートを取れなかった"));
                      }),
                  ),
            ],
          },
        ],
      },
      {
        id: "deck",
        title: "デッキ / Deck",
        sections: [
          {
            id: "sidebar",
            title: "サイドバー / Sidebar",
            items: [
              (c) => toggle(c, "サイドバーを使う / Use sidebar (デッキ画面のカード一覧・対戦のプレビューとログ)", "デッキ画面を開いている間だけ右サイドバーが出る。条件が空のときはデッキ内のカード、検索・フィルターすると追加できる(クリックで追加。削除・メインとサイドの入れ替えは、「ショートカット」で変えられる)。オフにすると、画面内の検索欄(従来の表示)に戻る。", "sidebar", () => this.onSidebar()),
              (c) => toggle(c, "一覧にイラストを出す / Art in card list", "サイドバーの一覧に、カードのイラストを薄く出す。重いと感じたらオフ。見えている行の分だけ読み込む。", "listArt", () => this.onSidebar()),
            ],
          },
          {
            id: "shortcut",
            title: "ショートカット / Shortcuts",
            desc: "デッキ画面のサイドバーの一覧で使う、クリックと組み合わせるキー。何も押さずにクリックすると、1枚追加する。",
            items: [
              (c) => keyPick(c, "1枚削除 / Remove one", "このキーを押しながらクリックすると、そのカードを1枚減らす(初期値 Shift)。", "keyRemove"),
              (c) => keyPick(c, "メイン ⇄ サイド / Move main ⇄ side", "このキーを押しながらクリックすると、そのカードを1枚、メインからサイドへ(サイドを表示しているときはメインへ)移す(初期値 ⌘ / Ctrl)。", "keyMove"),
            ],
          },
        ],
      },
      {
        id: "battle",
        title: "対戦 / Battle",
        sections: [
          {
            id: "opponent",
            title: "相手 / Opponent",
            items: [
              (c) =>
                toggles<"cpu" | "claude" | "passive">(
                  c,
                  "対戦の相手 / Battle opponent",
                  "雑魚 CPU: 機械的な決まりで動く(マリガン・土地・呪文・攻撃・ブロック)。AI: 盤面を API で渡して、判断させる(判断のたびに、有料の API を呼ぶことがある。どの AI かは、「AI」タブの「使い分け」。キーが無い・失敗したときは、以降、雑魚 CPU になる)。何もしない: 相手は何もしない(自分の操作の確認用)。開いている対戦の画面を開き直したときと、新しく始める対戦から反映。",
                  [["cpu", "雑魚 CPU"], ["claude", "AI"], ["passive", "何もしない"]],
                  this.settings.battleOpponent,
                  async (v) => {
                    this.settings.battleOpponent = v;
                    await this.save();
                  },
                ),
              (c) => toggle(c, "ランダムでミラーを選ばない / No mirror on random", "対戦を始めるとき、相手のデッキを「ランダム」にした場合、自分と同じデッキ(ミラー)を選ばない。同じフォーマットのデッキが、自分のデッキだけのときは、ミラーになる。相手を自分で選んだときは、ミラーも選べる。", "battleNoMirror"),
            ],
          },
          {
            id: "flow",
            title: "進み方 / Flow",
            items: [
              (c) =>
                new Setting(el(c))
                  .setName("対戦の止まり方 / Battle priority stops")
                  .setDesc("「次へ」は、次のステップへ進む。何もできないステップ(土地を出せない・唱えられない・使える能力が無い。土地やカードの能力のマナを全部出したと仮定)で、「使えるものがあるときだけ」は、真ん中の帯の時間ゲージ(3秒)が進んで、自動で次へ進む。できることがあるステップは、ゲージが満タンのまま待つ。「毎回止まる」は、ゲージが動かず、自分で「次へ」を押すまで待つ。")
                  .addDropdown((d) =>
                    d
                      .addOptions({ smart: "何もできないとき、ゲージで自動で進む", always: "毎回止まる" })
                      .setValue(this.settings.battleStops)
                      .onChange(async (v) => {
                        this.settings.battleStops = v === "always" ? "always" : "smart";
                        await this.save();
                      }),
                  ),
            ],
          },
          {
            id: "record",
            title: "記録と演出 / History & effects",
            items: [
              (c) => toggle(c, "対戦の履歴を保存する / Save battle history", "対戦が終わったとき(や、途中でやめたとき)、Battles/ に、ログとリプレイ用の記録を、ノートとして保存する。", "battleHistory"),
              (c) => toggle(c, "対戦の演出 / Battle effects", "ダメージやライフが変わったとき、数字を大きく出して、ふくらませて消す。相手の手札を見たとき、手札を前に出す。重いと感じたらオフ。", "battleEffects"),
            ],
          },
        ],
      },
      {
        id: "ai",
        title: "AI",
        sections: [
          {
            id: "connect",
            title: "接続 / Connections",
            desc: "API キーは、Obsidian のキーチェーンに保存される(設定のファイルには、保存先の名前だけが残る)。使わない種類は、空のままでよい。種類を切り替えても、ここの設定は、消えない。",
            items: [
              (c) => keyRow(c, "claude", "Claude の API キー / Claude API key", "Anthropic。"),
              (c) => keyRow(c, "openai", "OpenAI の API キー / OpenAI API key", "OpenAI。自分のパソコンで動かす AI (互換 API) で、キーが要らないときは、空のままでよい。"),
              (c) =>
                new Setting(el(c))
                  .setName("OpenAI の URL (互換 API のとき) / Base URL")
                  .setDesc("既定は https://api.openai.com/v1。Ollama なら http://localhost:11434/v1 。LM Studio なら http://localhost:1234/v1 。URL を変えると、キー無しでも使える。")
                  .addText((t) =>
                    t.setValue(ai.openaiBaseUrl).onChange(async (v) => {
                      ai.openaiBaseUrl = v.trim() || DEFAULT_AI.openaiBaseUrl;
                      await this.save();
                    }),
                  ),
              (c) => keyRow(c, "gemini", "Gemini の API キー / Gemini API key", "Google。"),
              (c) => keyRow(c, "jev", "Jev の API キー / Jev API key (TypeSafe)", "console.typesafe.ai で作る。Jev は、選ぶ仕事 (対戦の判断・ノードを選ぶ) だけに使える、速くて安いモデル。入力 100 万トークン 0.042 ドル。"),
            ],
          },
          {
            id: "scenes",
            title: "使い分け / AI by task",
            desc: "場面ごとに、使う AI の種類と、モデルを選ぶ(例: 対戦の相手は、安い Haiku。ルールを書かせるのは、強い Opus)。種類を切り替えても、各種類のモデルは、残る。モデル名は、各社の最新のものを、自分で入れる(初期値は、仮のもの)。盤面・履歴・カードの情報が、選んだ会社のサーバーに送られる。",
            items: SCENES.flatMap(([scene, label, desc]) => {
              const sc = ai.scenes[scene as Scene];
              return [
                (c: Ctx) =>
                  toggles<Provider>(c, label, desc, providersFor(scene as Scene), sc.provider, async (v) => {
                    sc.provider = v;
                    await this.save();
                  }),
                (c: Ctx) =>
                  new Setting(el(c))
                    .setName(`　モデル (${PROVIDERS.find(([id]) => id === sc.provider)![1]})`)
                    .setDesc(hint[sc.provider])
                    .addText((t) =>
                      t.setValue(sc.models[sc.provider]).onChange(async (v) => {
                        sc.models[sc.provider] = v.trim() || DEFAULT_AI.scenes[scene as Scene].models[sc.provider];
                        await this.save();
                      }),
                    ),
              ];
            }),
          },
          {
            id: "jev",
            title: "Jev の使い方 / Jev options",
            desc: "Jev (速くて安い、選ぶだけのモデル) を、「対戦の相手」「ノードを選ぶ」に選んだときの設定。Jev は、文章を作れないので、ルールを書かせる・メモの下書きには、選べない。",
            items: [
              (c) =>
                new Setting(el(c))
                  .setName("対戦: 自信のしきい値 / Confidence threshold")
                  .setDesc("対戦の判断で、Jev の自信がこの値以上なら、Jev の答えを使う。未満なら、下の「聞き直す AI」に聞く。高いほど、慎重 (AI を呼ぶ回数が増える)。0.5〜1。")
                  .addSlider((s) =>
                    s.setLimits(0.5, 1, 0.05).setValue(ai.jev.confidence).setDynamicTooltip().onChange(async (v) => {
                      ai.jev.confidence = v;
                      await this.save();
                    }),
                  ),
              (c) => {
                const st = new Setting(el(c)).setName("対戦: 聞き直す AI / Fallback AI").setDesc("Jev の自信が足りないときに、聞く AI (モデルは、「対戦の相手」の、その AI のモデル欄)。使わない: Jev の答えを、そのまま使う (いちばん安く速いが、判断が粗くなる)。");
                const row = st.controlEl.createDiv("mtg-seg");
                for (const [v, label] of [["claude", "Claude"], ["openai", "OpenAI"], ["gemini", "Gemini"], ["none", "使わない"]] as [TextProvider | "none", string][]) {
                  row.createEl("button", { text: label, cls: v === ai.jev.fallback ? "is-on" : "" }).addEventListener("click", async () => {
                    ai.jev.fallback = v;
                    await this.save();
                    this.display();
                  });
                }
              },
              (c) =>
                new Setting(el(c))
                  .setName("ノード選び: 拾う確率 / Node recall")
                  .setDesc("ノードを選ぶとき、「要る」の確率がこの値以上のノードを、ルールを書かせる AI に渡す。低いほど、見落とさない (渡すノードが増える)。0.01〜0.9。")
                  .addSlider((s) =>
                    s.setLimits(0.05, 0.9, 0.05).setValue(ai.jev.recall).setDynamicTooltip().onChange(async (v) => {
                      ai.jev.recall = v;
                      await this.save();
                    }),
                  ),
            ],
          },
        ],
      },
    ];
  }

  display() {
    const root = this.containerEl;
    root.empty();
    root.addClass("mtg-settings");
    const tabs = this.tabs();
    if (!tabs.some((t) => t.id === SettingsTab.activeTab)) SettingsTab.activeTab = tabs[0].id;
    const bar = root.createDiv("mtg-settabs");
    for (const t of tabs) {
      const b = bar.createEl("button", { text: t.title, cls: t.id === SettingsTab.activeTab ? "is-on" : "" });
      b.addEventListener("click", () => {
        SettingsTab.activeTab = t.id;
        this.display();
      });
    }
    const tab = tabs.find((t) => t.id === SettingsTab.activeTab)!;
    for (const s of tab.sections) {
      const key = `${tab.id}/${s.id}`;
      const open = !SettingsTab.closed.has(key);
      const sec = root.createDiv({ cls: `mtg-setsec${open ? " is-open" : ""}` });
      const head = sec.createDiv("mtg-setsec-head");
      head.createSpan({ cls: "mtg-setsec-arrow", text: open ? "▾" : "▸" });
      head.createSpan({ cls: "mtg-setsec-title", text: s.title });
      head.addEventListener("click", () => {
        if (open) SettingsTab.closed.add(key);
        else SettingsTab.closed.delete(key);
        this.display();
      });
      if (!open) continue;
      const body = sec.createDiv("mtg-setsec-body");
      if (s.desc) body.createDiv({ cls: "setting-item-description mtg-setsec-desc", text: s.desc });
      for (const item of s.items) item({ el: body });
    }
  }
}
