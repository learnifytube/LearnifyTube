import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { createPairingStore } from "./pairing-store";

describe("createPairingStore", () => {
  let root: string;
  let filePath: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pairing-"));
    filePath = path.join(root, "mobile-sync-pairing.json");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("generates a code on first use and keeps it across store instances", () => {
    const first = createPairingStore(filePath).getCode();
    expect(first).toMatch(/^[A-Z0-9]{8}$/);
    expect(createPairingStore(filePath).getCode()).toBe(first);
  });

  test("reset replaces the code, and the old one is gone for new instances", () => {
    const store = createPairingStore(filePath);
    const original = store.getCode();
    const replaced = store.reset();
    expect(replaced).not.toBe(original);
    expect(store.getCode()).toBe(replaced);
    expect(createPairingStore(filePath).getCode()).toBe(replaced);
  });

  test("replaces a corrupt file with a fresh code", () => {
    fs.writeFileSync(filePath, "not json");
    const code = createPairingStore(filePath).getCode();
    expect(code).toMatch(/^[A-Z0-9]{8}$/);
    expect(createPairingStore(filePath).getCode()).toBe(code);
  });
});
