import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { avds, log, repoRoot, type Surface } from "./env";
import { emulatorSerials } from "./emulator";

export const flowsDir = path.join(repoRoot, ".cursor/skills/verify/flows");

/** Flows are named for the surface they drive: phone-*.yaml, tv-*.yaml. */
export const flowSurface = (flow: string) => {
  const surface = flow.split("-")[0];
  if (!(surface in avds)) {
    throw new Error(`flow ${flow} must start with phone- or tv-`);
  }
  return surface as Surface;
};

export const flowPath = (flow: string) => {
  const file = path.join(flowsDir, `${flow}.yaml`);
  if (!fs.existsSync(file)) {
    const known = fs
      .readdirSync(flowsDir)
      .map((name) => name.replace(/\.yaml$/, ""));
    throw new Error(`no flow ${flow}; known: ${known.join(", ")}`);
  }
  return file;
};

/** Runs one flow on its surface's emulator; Maestro output lands in outDir. */
export const runFlow = async (flow: string, outDir: string) => {
  const surface = flowSurface(flow);
  const serial = (await emulatorSerials())[surface];
  if (!serial) {
    throw new Error(
      `${avds[surface]} is not running; run: npm run verify -- up`,
    );
  }
  fs.mkdirSync(outDir, { recursive: true });
  log(`${flow} on ${serial}`);
  const output = fs.openSync(path.join(outDir, "maestro.log"), "w");
  const code = await new Promise<number | null>((resolve) => {
    const child = spawn(
      "maestro",
      ["--device", serial, "test", "--test-output-dir", outDir, flowPath(flow)],
      { stdio: ["ignore", output, output] },
    );
    child.on("close", resolve);
  });
  fs.closeSync(output);
  return { ok: code === 0, surface, serial };
};
