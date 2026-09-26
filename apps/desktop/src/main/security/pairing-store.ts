import * as fs from "fs";
import * as path from "path";
import { z } from "zod";

import { generatePairingCode } from "./sync-auth";

/**
 * Persists the desktop's mobile sync pairing code in a small JSON file, so a
 * paired device keeps working across restarts until the user resets the code.
 */

const pairingFileSchema = z.object({ code: z.string().min(1) });

export type PairingStore = {
  getCode: () => string;
  reset: () => string;
};

const readCode = (filePath: string): string | null => {
  try {
    const parsed = pairingFileSchema.safeParse(JSON.parse(fs.readFileSync(filePath, "utf8")));
    return parsed.success ? parsed.data.code : null;
  } catch {
    return null;
  }
};

const writeCode = (filePath: string, code: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ code }), { encoding: "utf8", mode: 0o600 });
};

export const createPairingStore = (filePath: string): PairingStore => {
  let cached: string | null = null;

  const reset = (): string => {
    const code = generatePairingCode();
    writeCode(filePath, code);
    cached = code;
    return code;
  };

  const getCode = (): string => {
    if (cached) {
      return cached;
    }
    const stored = readCode(filePath);
    if (stored) {
      cached = stored;
      return stored;
    }
    return reset();
  };

  return { getCode, reset };
};
