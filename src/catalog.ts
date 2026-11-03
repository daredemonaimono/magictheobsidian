import { App, TFile, normalizePath } from "obsidian";
import { cardInfo, localCards } from "./cards";
import { RULE_DIR, loadRule } from "./cardrules";
import { CATEGORIES, TYPE_ENTRIES, TypeEntry, collectUsage } from "./typecatalog";

export const TYPES_DIR = "Bot/Types";
const MEMO = "## 要望・メモ(自分で書く)";
const STATUS_JA = { implemented: "実装済み", partial: "一部だけ", planned: "未実装" } as const;
const MARK = { implemented: "✅", partial: "🟡", planned: "⬜" } as const;

const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, "-");
const fileOf = (e: TypeEntry) => normalizePath(`${TYPES_DIR}/${e.category}/${safe(e.title)}.md`);

async function ensureFolder(app: App, path: string) {
  let cur = "";
  for (const part of normalizePath(path).split("/")) {
    cur = cur ? `${cur}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(cur)) await app.vault.createFolder(cur);
  }
}

async function write(app: App, path: string, body: string) {
  const f = app.vault.getAbstractFileByPath(path);
  if (f instanceof TFile) await app.vault.modify(f, body);
  else await app.vault.create(path, body);
}

// 古いノートの「要望・メモ」(自分で書いた部分) と、request の印を引き継ぐ
async function keepUser(app: App, path: string): Promise<{ memo: string; request: boolean }> {
  const f = app.vault.getAbstractFileByPath(path);
  if (!(f instanceof TFile)) return { memo: "", request: false };
  const text = await app.vault.cachedRead(f);
  const i = text.indexOf(MEMO);
  return { memo: i >= 0 ? text.slice(i + MEMO.length).replace(/^\n+/, "").trimEnd() : "", request: /^request: true$/m.test(text) };
}

// カタログを Bot/Types/ に書き出す。元データは typecatalog.ts。自分で書いた「要望・メモ」は残る
export async function writeCatalog(app: App, version: string): Promise<{ types: number; unsupported: number }> {
  await ensureFolder(app, TYPES_DIR);
  for (const c of CATEGORIES) await ensureFolder(app, `${TYPES_DIR}/${c}`);

  // 記録 (Bot/Rules) が使っている型と、未対応の文を集める
  const users = new Map<string, Set<string>>(); // 型の id → カード名
  const unsupported = new Map<string, Set<string>>(); // 未対応の文 → カード名
  const rules = app.vault.getFiles().filter((f) => f.path.startsWith(`${RULE_DIR}/`) && f.extension === "md");
  for (const f of rules) {
    const key = f.basename;
    const rule = await loadRule(app, key);
    if (!rule) continue;
    const name = cardInfo(app, key)?.name ?? key;
    for (const id of collectUsage(rule.abilities)) (users.get(id) ?? users.set(id, new Set()).get(id)!).add(name);
    for (const u of rule.unsupported) (unsupported.get(u) ?? unsupported.set(u, new Set()).get(u)!).add(name);
  }
  for (const c of localCards(app)) for (const k of c.keywords ?? []) (users.get(`kw.${k.toLowerCase()}`) ?? users.set(`kw.${k.toLowerCase()}`, new Set()).get(`kw.${k.toLowerCase()}`)!).add(c.name);
  const landwalk = ["islandwalk", "swampwalk", "mountainwalk", "forestwalk", "plainswalk"];
  for (const w of landwalk) for (const n of users.get(`kw.${w}`) ?? []) (users.get("kw.landwalk") ?? users.set("kw.landwalk", new Set()).get("kw.landwalk")!).add(n);

  for (const e of TYPE_ENTRIES) {
    const path = fileOf(e);
    const keep = await keepUser(app, path);
    const cards = [...(users.get(e.id) ?? [])].sort();
    const body = [
      "---",
      "mtg: bot-type",
      `id: ${e.id}`,
      `category: ${e.category}`,
      `status: ${e.status}`,
      ...(e.since ? [`since: ${e.since}`] : []),
      ...(keep.request ? ["request: true"] : []),
      "tags: [mtg/bot-type]",
      "---",
      "",
      `# ${e.title}`,
      "",
      `状態: ${MARK[e.status]} ${STATUS_JA[e.status]}${e.since ? `(${e.since} から)` : ""}`,
      "",
      "## 何か",
      "",
      e.summary,
      ...(e.shape ? ["", "## 書き方(記録の JSON)", "", "```json", e.shape, "```"] : []),
      ...(e.impl ? ["", "## どう実装されているか", "", e.impl] : []),
      ...(e.limits ? ["", "## 制限・未対応", "", e.limits] : []),
      ...(e.example ? ["", "## 例", "", e.example] : []),
      "",
      "## 使っているカード",
      "",
      cards.length ? `${cards.length} 枚: ${cards.slice(0, 40).map((n) => `[[${n}]]`).join("、")}${cards.length > 40 ? " …" : ""}` : "(いまの記録・カードには無い)",
      "",
      MEMO,
      "",
      keep.memo || "(この型について、作ってほしいこと・気づいたことを、ここに書く。書いた内容は、書き出し直しても消えない。要望なら、frontmatter に `request: true` を足す)",
      "",
    ].join("\n");
    await write(app, path, body);
  }

  // 一覧
  const index: string[] = [
    "---",
    "mtg: bot-types-index",
    `version: ${version}`,
    "tags: [mtg/bot-type]",
    "---",
    "",
    "# 効果の型・ルールの一覧",
    "",
    `エンジンがどこまで実装されているか、どう実装されているかの一覧(プラグイン ${version} 時点)。型ごとのノートに、書き方・実装・制限・使っているカードがある。`,
    "作ってほしいものは、型のノート(または「要望」)に書く。状態の元データはコード(`typecatalog.ts`)で、このフォルダは、プラグインの更新のたびに書き直される(「要望・メモ」の欄は残る)。",
    "",
    `- ✅ 実装済み ${TYPE_ENTRIES.filter((e) => e.status === "implemented").length} / 🟡 一部だけ ${TYPE_ENTRIES.filter((e) => e.status === "partial").length} / ⬜ 未実装 ${TYPE_ENTRIES.filter((e) => e.status === "planned").length}`,
    "- [[未実装の効果]] — カードの記録に残っている「未対応」の文の一覧",
    "- [[要望]] — 作ってほしいことを書く場所",
    "",
  ];
  for (const c of CATEGORIES) {
    index.push(`## ${c}`, "");
    for (const e of TYPE_ENTRIES.filter((x) => x.category === c)) {
      const n = users.get(e.id)?.size ?? 0;
      index.push(`- ${MARK[e.status]} [[${safe(e.title)}]] — ${e.summary.slice(0, 60)}${e.summary.length > 60 ? "…" : ""}${n ? ` (${n} 枚)` : ""}`);
    }
    index.push("");
  }
  await write(app, normalizePath(`${TYPES_DIR}/一覧.md`), index.join("\n"));

  // 未実装の効果 (記録から)
  const rows = [...unsupported.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
  await write(
    app,
    normalizePath(`${TYPES_DIR}/未実装の効果.md`),
    [
      "---",
      "mtg: bot-unsupported",
      `version: ${version}`,
      "tags: [mtg/bot-type]",
      "---",
      "",
      "# 未実装の効果(記録から)",
      "",
      "`Bot/Rules/` の記録に「未対応」として残っている文を、同じ文ごとにまとめたもの(エンジンが実行できない部分)。カードが多い順。作ってほしいものは、[[要望]] に書く。",
      "",
      ...(rows.length ? rows.map(([text, cards]) => `- ${text}\n  - ${cards.size} 枚: ${[...cards].sort().map((n) => `[[${n}]]`).join("、")}`) : ["- なし"]),
      "",
    ].join("\n"),
  );

  // 要望 (最初の1回だけ作る。以後は触らない)
  const req = normalizePath(`${TYPES_DIR}/要望.md`);
  if (!app.vault.getAbstractFileByPath(req)) {
    await write(app, req, ["---", "mtg: bot-requests", "tags: [mtg/bot-type]", "---", "", "# 作ってほしいこと", "", "[[一覧]] と [[未実装の効果]] を見て、作ってほしい型・効果を、ここに書く(カード名と、どう動いてほしいか)。", "", "- [ ] ", ""].join("\n"));
  }
  return { types: TYPE_ENTRIES.length, unsupported: rows.length };
}
