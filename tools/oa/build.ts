import { build, type Plugin } from "esbuild";
import { chmodSync, writeFileSync } from "node:fs";

// Ink/React (and the Ink widget libs) stay external — they ship native ESM that
// resolves from node_modules at runtime. commander stays bundled.
const INK_EXTERNAL = ["ink", "react", "react-dom", "ink-text-input", "ink-select-input", "ink-spinner", "react-devtools-core"];

// Shebang + a require shim so bundled CommonJS deps (e.g. commander) work in ESM.
const banner = {
  js: [
    "#!/usr/bin/env node",
    "import { createRequire as __cr } from 'node:module';",
    "const require = __cr(import.meta.url);",
  ].join("\n"),
};

// Keep the interactive TUI out of dist/cli.js entirely so the scripting fast
// path (`oa flow list --json`) never imports React/Ink. The dev-time dynamic
// import `import("./tui/run.tsx")` is rewritten to the built `./tui/run.js`
// sibling and marked external, so it is only loaded when the TUI actually runs.
const lazyTui: Plugin = {
  name: "lazy-tui",
  setup(b) {
    b.onResolve({ filter: /\.\/tui\/run\.tsx$/ }, () => ({ path: "./tui/run.js", external: true }));
  },
};

// 1) The CLI entry — React/Ink-free at the top level.
await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/cli.js",
  banner,
  plugins: [lazyTui],
});

// 2) The lazy TUI chunk — only imported on demand; Ink/React stay external.
await build({
  entryPoints: ["src/tui/run.tsx"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/tui/run.js",
  banner,
  external: INK_EXTERNAL,
  jsx: "automatic",
});

chmodSync("dist/cli.js", 0o755);
// Mark dist/ as ESM so node never has to walk up to a parent package.json to
// learn the module type — keeps the bundle self-contained even when dist/cli.js
// is run or copied outside the package tree.
writeFileSync("dist/package.json", JSON.stringify({ type: "module" }, null, 2) + "\n");
console.log("built dist/cli.js + dist/tui/run.js");
