import { build } from "esbuild";
import { chmodSync, writeFileSync } from "node:fs";

// Bundle the CLI to a single runnable ESM file with a node shebang.
await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/cli.js",
  // Shim `require` so bundled CommonJS deps (e.g. commander) work inside ESM.
  banner: {
    js: [
      "#!/usr/bin/env node",
      "import { createRequire as __cr } from 'node:module';",
      "const require = __cr(import.meta.url);",
    ].join("\n"),
  },
});
chmodSync("dist/cli.js", 0o755);
// Mark dist/ as ESM so node never has to walk up to a parent package.json to
// learn the module type — keeps the bundle self-contained (no MODULE_TYPELESS
// warning) even when dist/cli.js is run or copied outside the package tree.
writeFileSync("dist/package.json", JSON.stringify({ type: "module" }, null, 2) + "\n");
console.log("built dist/cli.js");
