import assert from "node:assert";
import { writeCatalog } from "../src/catalog";
import { TFile } from "obsidian";

// 模擬の vault (ファイルとフォルダをメモリに持つ)。カタログの書き出しが、期待通りのノートを作るか確かめる
class Mem {
  files = new Map<string, string>();
  folders = new Set<string>();
  made = new Map<string, TFile>();
  private file(path: string): TFile {
    let f = this.made.get(path);
    if (!f) {
      f = Object.assign(new TFile(), { path, basename: path.split("/").pop()!.replace(/\.md$/, ""), extension: "md" });
      this.made.set(path, f);
    }
    return f;
  }
  vault = {
    getAbstractFileByPath: (p: string) => (this.files.has(p) ? this.file(p) : this.folders.has(p) ? { path: p } : null),
    createFolder: async (p: string) => void this.folders.add(p),
    create: async (p: string, body: string) => (this.files.set(p, body), this.file(p)),
    modify: async (f: TFile & { path: string }, body: string) => void this.files.set(f.path, body),
    cachedRead: async (f: TFile & { path: string }) => this.files.get(f.path) ?? "",
    getFiles: () => [...this.files.keys()].map((p) => this.file(p)),
    getMarkdownFiles: () => [...this.files.keys()].filter((p) => p.endsWith(".md")).map((p) => this.file(p)),
  };
  metadataCache = { getFileCache: (_f: unknown) => undefined };
}

const m = new Mem();
const rule = (name: string, abilities: unknown, unsupported: string[]) =>
  m.files.set(`Bot/Rules/${name}.md`, `---\nmtg: bot-rule\n---\n\n## 未対応\n\n${unsupported.map((u) => `- ${u}`).join("\n") || "- なし"}\n\n## 処理\n\n\`\`\`json\n${JSON.stringify({ abilities })}\n\`\`\`\n`);
rule("Thoughtseize", [{ kind: "spell", effects: [{ do: "move", what: { kind: "cards", zone: "hand", owner: "opponent", count: 1, chooser: "you" }, to: "graveyard", how: "discard" }] }], []);
rule("Bowmasters", [{ kind: "triggered", trigger: { event: "etb" }, effects: [{ do: "unsupported", text: "Then amass Orcs 1." }] }], ["Then amass Orcs 1.", "Flash"]);

const r = await writeCatalog(m as never, "9.9.9");
assert.ok(r.types > 50, "型のノートを書く");
assert.equal(r.unsupported, 1, "未対応は、キーワード (Flash) を除いて、1種類");
const move = [...m.files.entries()].find(([p]) => p.includes("move (移す)"))!;
assert.ok(move[0].startsWith("Bot/Types/命令/"), "カテゴリのフォルダに置く");
assert.ok(move[1].includes("status: implemented") && move[1].includes("## どう実装されているか") && move[1].includes("[[Thoughtseize]]"), "実装の説明と、使っているカードが入る");
assert.ok(m.files.get("Bot/Types/未実装の効果.md")!.includes("Then amass Orcs 1.") && !m.files.get("Bot/Types/未実装の効果.md")!.includes("Flash"), "未実装の効果の一覧");
assert.ok(m.files.get("Bot/Types/一覧.md")!.includes("✅") && m.files.has("Bot/Types/要望.md"));

// 自分で書いたメモは、書き出し直しても残る。要望の印も残る
m.files.set(move[0], move[1].replace("tags: [mtg/bot-type]", "request: true\ntags: [mtg/bot-type]").replace(/(## 要望・メモ\(自分で書く\)\n\n)[\s\S]*$/, "$1サーチの条件に色も足したい\n"));
m.files.set("Bot/Types/要望.md", "自分の要望");
await writeCatalog(m as never, "9.9.10");
const again = m.files.get(move[0])!;
assert.ok(again.includes("サーチの条件に色も足したい") && again.includes("request: true"), "メモと request が残る");
assert.equal(m.files.get("Bot/Types/要望.md"), "自分の要望", "要望のノートは上書きしない");
console.log("catalog ok");
