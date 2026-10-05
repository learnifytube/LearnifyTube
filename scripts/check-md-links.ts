// Fails when a tracked Markdown file has a relative link to a path that doesn't exist.
// Run: node --experimental-strip-types scripts/check-md-links.ts
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const files = execFileSync("git", ["ls-files", "*.md"], { encoding: "utf8" })
  .split("\n")
  .filter((file) => file && existsSync(file));

const linkPattern = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const broken: string[] = [];

for (const file of files) {
  const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
  for (const [, target] of text.matchAll(linkPattern)) {
    if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) continue;
    const path = decodeURIComponent(target.split("#")[0]);
    if (!path) continue;
    const resolved = path.startsWith("/") ? path.slice(1) : join(dirname(file), path);
    if (!existsSync(resolved)) broken.push(`${file}: ${target}`);
  }
}

if (broken.length > 0) {
  console.error(`Broken relative links:\n${broken.map((b) => `  ${b}`).join("\n")}`);
  process.exit(1);
}
console.log(`Checked ${files.length} Markdown files: no broken relative links.`);
