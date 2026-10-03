#!/usr/bin/env node
/**
 * Attach to the verify Electron via CDP and write a PNG.
 * Memory history: pass --sidebar <title> to click a desktop sidebar link.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const require = createRequire(path.join(repoRoot, "apps/desktop/package.json"));
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

const out = flag("--out");
if (!out) {
  console.error("Usage: desktop-shot.mjs --out <png> [--sidebar <title>] [--click <text>]");
  process.exit(1);
}

const cdp = process.env.VERIFY_CDP_URL ?? "http://127.0.0.1:9333";
const sidebar = flag("--sidebar");
const click = flag("--click");

const browser = await chromium.connectOverCDP(cdp);
const context = browser.contexts()[0];
if (!context) {
  console.error("No Chromium context on CDP — is the verify desktop up?");
  process.exit(1);
}
const page =
  context.pages().find((p) => !p.url().startsWith("devtools://")) ?? context.pages()[0];
if (!page) {
  console.error("No renderer page on CDP");
  process.exit(1);
}

await page.waitForLoadState("domcontentloaded");

if (sidebar) {
  await page.getByRole("link", { name: sidebar, exact: true }).click();
  await page.waitForTimeout(400);
}

if (click) {
  await page.getByText(click, { exact: true }).first().click();
  await page.waitForTimeout(600);
}

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
await page.screenshot({ path: out, fullPage: false });
console.log(out);
await browser.close();
