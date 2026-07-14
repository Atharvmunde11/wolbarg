/**
 * esbuild/tsup rewrites `node:sqlite` → `sqlite` in emitted output.
 * Patch dist files so Node resolves the builtin correctly.
 */
import fs from "node:fs";
import path from "node:path";

const distDir = path.resolve("dist");

/** @type {Array<[RegExp, string]>} */
const replacements = [
  [/from ["']sqlite["']/g, 'from "node:sqlite"'],
  [/require\(["']sqlite["']\)/g, 'require("node:sqlite")'],
  [/from ["']fs["']/g, 'from "node:fs"'],
  [/require\(["']fs["']\)/g, 'require("node:fs")'],
  [/from ["']path["']/g, 'from "node:path"'],
  [/require\(["']path["']\)/g, 'require("node:path")'],
];

for (const file of fs.readdirSync(distDir)) {
  if (!file.endsWith(".js") && !file.endsWith(".cjs")) {
    continue;
  }
  const fullPath = path.join(distDir, file);
  let source = fs.readFileSync(fullPath, "utf8");
  let changed = false;
  for (const [pattern, replacement] of replacements) {
    const next = source.replace(pattern, replacement);
    if (next !== source) {
      source = next;
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(fullPath, source, "utf8");
    console.log(`patched ${file}`);
  }
}
