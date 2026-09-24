// Copy the static export (out/) into ../docs, which GitHub Pages serves.
// Keeps docs/demo and docs/screenshots (hand-made assets), replaces the rest.
const fs = require("fs");
const path = require("path");

const out = path.join(__dirname, "..", "out");
const docs = path.join(__dirname, "..", "..", "docs");
const KEEP = new Set(["demo", "screenshots"]);

if (!fs.existsSync(path.join(out, "index.html"))) {
  console.error("out/index.html missing — run the Pages build first.");
  process.exit(1);
}
fs.mkdirSync(docs, { recursive: true });
for (const entry of fs.readdirSync(docs)) {
  if (!KEEP.has(entry)) fs.rmSync(path.join(docs, entry), { recursive: true, force: true });
}
fs.cpSync(out, docs, { recursive: true });
fs.writeFileSync(path.join(docs, ".nojekyll"), "");
console.log("Published static site to docs/");
