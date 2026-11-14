// 自分で置いたフォント (プラグインのフォルダの fonts/ の中) を、読み込む。ダウンロードは、しない: ファイルは、自分で入れる。
// 同梱できないフォント (Beleren・MagicMedieval・Planewalker など。ファンが作ったもので、再配布してよいか、はっきりしない) 用。
// フォルダは、プラグインのフォルダの中で、リポジトリの外 (コミットされない)。
export const FONT_DIR = "fonts";
export const FONT_EXT = /\.(ttf|otf|woff2?)$/i;
export const MAX_FONT_BYTES = 30 * 1024 * 1024; // これより大きいファイルは、読まない

// styles.css の並びが、先頭に探す名前。ファイル名 (拡張子の前) に、この文字が入っていれば、これらの名前でも、登録する
const ALIASES: { match: RegExp; families: string[] }[] = [
  { match: /beleren/i, families: ["Beleren2016", "Beleren", "JaceBeleren"] },
  { match: /magic[\s_-]?medieval/i, families: ["MagicMedieval"] },
  { match: /planewalker(?![\s_-]?dings)/i, families: ["Planewalker"] }, // Planewalker Dings (記号のフォント) は、本文の Planewalker にしない
];

// ファイル名から、登録するフォントの名前 (CSS の font-family)。ファイル名そのもの + 上の別名
export function familiesFor(fileName: string): string[] {
  const base = fileName.replace(FONT_EXT, "");
  return [...new Set([base, ...ALIASES.filter((a) => a.match.test(base)).flatMap((a) => a.families)])];
}

// 太字か (ファイル名に Bold が入っている): font-weight / 斜体か (Italic が入っている): font-style に使う。ふつうの字と、斜体・太字が、同じ名前で、ぶつからないように
export const weightFor = (fileName: string): string => (/bold/i.test(fileName) ? "700" : "400");
export const styleFor = (fileName: string): string => (/italic|oblique/i.test(fileName) ? "italic" : "normal");

export interface FontAdapter {
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<{ files: string[] }>;
  readBinary(path: string): Promise<ArrayBuffer>;
}
export interface Loaded {
  file: string;
  families: string[];
}

// フォルダの中のフォントを、ブラウザに登録する。登録したものを返す (外すときのため)
export async function loadLocalFonts(adapter: FontAdapter, pluginDir: string, add: (face: FontFace) => void): Promise<{ loaded: Loaded[]; faces: FontFace[]; skipped: string[] }> {
  const dir = `${pluginDir}/${FONT_DIR}`;
  const out = { loaded: [] as Loaded[], faces: [] as FontFace[], skipped: [] as string[] };
  if (!(await adapter.exists(dir))) return out;
  for (const path of (await adapter.list(dir)).files) {
    const file = path.split("/").pop()!;
    if (!FONT_EXT.test(file)) continue;
    try {
      const data = await adapter.readBinary(path);
      if (data.byteLength > MAX_FONT_BYTES) { out.skipped.push(file); continue; }
      const families = familiesFor(file);
      for (const family of families) {
        const face = new FontFace(family, data, { weight: weightFor(file), style: styleFor(file) });
        await face.load(); // 壊れたファイルは、ここで、エラーになる
        add(face);
        out.faces.push(face);
      }
      out.loaded.push({ file, families });
    } catch {
      out.skipped.push(file);
    }
  }
  return out;
}
