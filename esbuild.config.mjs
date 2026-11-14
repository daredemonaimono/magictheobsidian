import esbuild from "esbuild";
import builtins from "module";

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtins.builtinModules],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: false,
  treeShaking: true,
  outfile: "main.js",
  loader: { ".md": "text" }, // AI への手引き (docs/ai-guide.md) を、そのまま、main.js に入れる
});
