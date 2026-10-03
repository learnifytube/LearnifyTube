#!/usr/bin/env node
const endpoint = process.env.VERIFY_CDP_URL ?? "http://127.0.0.1:9333/json/version";
const deadline = Date.now() + Number(process.env.VERIFY_CDP_TIMEOUT_MS ?? 120_000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

while (Date.now() < deadline) {
  try {
    const response = await fetch(endpoint);
    if (response.ok) {
      const body = await response.json();
      console.log(`CDP ready: ${body.Browser ?? endpoint}`);
      process.exit(0);
    }
  } catch {
    // Electron has not opened the debug port yet.
  }
  await sleep(500);
}

console.error(`CDP did not answer at ${endpoint}`);
process.exit(1);
