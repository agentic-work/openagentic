import { build } from "esbuild";
import { chmodSync } from "node:fs";

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
console.log("built dist/cli.js");
