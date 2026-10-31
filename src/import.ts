import { App, Modal, Notice, Setting, TFile, normalizePath } from "obsidian";
import { CARD_DIR, ensureCardFile } from "./cards";
import { Deck, parseMoxfield } from "./deck";
import { fetchPrint, fileSafe } from "./scryfall";
import { Settings } from "./settings";

// Moxfield 形式のテキストを、Cards/ のファイル名をキーにした Deck にする。
// カードは (セット, 番号) で版まで指定して取得し、Cards/ に無いものだけノート化する。
// 取得できなかったカードは通知して除く。読み取れる行が無ければ null
export async function resolveDeck(app: App, settings: Settings, text: string): Promise<{ deck: Deck; failed: string[] } | null> {
  const parsed = parseMoxfield(text);
  const total = parsed.main.size + parsed.side.size;
  if (!total) {
    new Notice("読み取れる行が無い (例: 4 Lightning Bolt (M11) 149)");
    return null;
  }

  const keys = new Map<string, string>(); // 行のカード名 -> Cards/ のファイル名
  const failed: string[] = [];
  let done = 0;
  const notice = new Notice(`取り込み中… 0/${total}`, 0);
  for (const [cardName, e] of [...parsed.main, ...parsed.side]) {
    if (keys.has(cardName)) continue;
    try {
      const existing = app.vault.getAbstractFileByPath(normalizePath(`${CARD_DIR}/${fileSafe(cardName)}.md`));
      if (existing instanceof TFile) {
        keys.set(cardName, existing.basename);
      } else {
        const [set, no] = e.print!.split(" ");
        keys.set(cardName, (await ensureCardFile(app, await fetchPrint(set, no), settings)).basename);
        await new Promise((r) => setTimeout(r, 100)); // Scryfall の負荷配慮
      }
    } catch {
      failed.push(cardName);
    }
    notice.setMessage(`取り込み中… ${++done}/${total}`);
  }
  notice.hide();

  const deck: Deck = { main: new Map(), side: new Map() };
  for (const board of ["main", "side"] as const) {
    for (const [cardName, e] of parsed[board]) {
      const key = keys.get(cardName);
      if (key) deck[board].set(key, e);
    }
  }
  new Notice(failed.length ? `取り込み完了。取得できなかった ${failed.length} 枚: ${failed.join(", ")}` : `取り込み完了: ${total} 種類`, failed.length ? 0 : 4000);
  return { deck, failed };
}

// askName: 新しいデッキを作るときだけデッキ名を聞く
export class ImportModal extends Modal {
  private name = "";
  private text = "";
  constructor(app: App, private askName: boolean, private onSubmit: (name: string, text: string) => void) {
    super(app);
  }
  onOpen() {
    this.setTitle("Import deck (Moxfield text)");
    if (this.askName) new Setting(this.contentEl).setName("Deck name").addText((t) => t.setPlaceholder("リアニ").onChange((v) => (this.name = v)));
    const area = this.contentEl.createEl("textarea", { attr: { rows: "14", placeholder: "4 Lightning Bolt (M11) 149\n...\n\nSIDEBOARD:\n3 Smash to Smithereens (ROE) 160" } });
    area.style.width = "100%";
    area.addEventListener("input", () => (this.text = area.value));
    new Setting(this.contentEl).addButton((b) =>
      b.setButtonText("Import").setCta().onClick(() => {
        if ((this.askName && !this.name.trim()) || !this.text.trim()) return new Notice(this.askName ? "デッキ名とリストを入れる" : "リストを入れる");
        this.close();
        this.onSubmit(this.name.trim(), this.text);
      }),
    );
  }
  onClose() {
    this.contentEl.empty();
  }
}
