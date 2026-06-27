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
  banner: { js: "#!/usr/bin/env node" },
});
chmodSync("dist/cli.js", 0o755);
console.log("built dist/cli.js");
