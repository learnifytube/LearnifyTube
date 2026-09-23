import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { resolveWithinAllowed } from "./path-confinement";

describe("resolveWithinAllowed", () => {
  let root: string;
  let allowed: string;
  let outside: string;

  beforeEach(() => {
    // realpathSync collapses macOS /var -> /private/var symlinks, so resolve
    // the temp root up front and compare against the canonical form.
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "confine-")));
    allowed = path.join(root, "allowed");
    outside = path.join(root, "outside");
    fs.mkdirSync(allowed, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const writeFile = (dir: string, name: string): string => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, "data");
    return p;
  };

  test("accepts a file inside an allowed directory and returns its real path", () => {
    const file = writeFile(allowed, "video.mp4");
    const result = resolveWithinAllowed(file, [allowed]);
    expect(result).toEqual({ ok: true, realPath: file });
  });

  test("accepts a file in a nested subdirectory of an allowed directory", () => {
    const nested = path.join(allowed, "sub", "deep");
    fs.mkdirSync(nested, { recursive: true });
    const file = writeFile(nested, "video.mp4");
    const result = resolveWithinAllowed(file, [allowed]);
    expect(result).toEqual({ ok: true, realPath: file });
  });

  test("rejects parent-directory traversal that escapes the allowlist", () => {
    const secret = writeFile(outside, "secret.txt");
    const traversal = path.join(allowed, "..", "outside", "secret.txt");
    // sanity: the lexical traversal really does point at the secret file
    expect(fs.existsSync(traversal)).toBe(true);
    expect(secret).toBe(path.resolve(traversal));

    const result = resolveWithinAllowed(traversal, [allowed]);
    expect(result.ok).toBe(false);
  });

  test("rejects URL-encoded traversal once the caller decodes it", () => {
    writeFile(outside, "secret.txt");
    const encoded = `${allowed}/%2e%2e/outside/secret.txt`;
    const decoded = decodeURIComponent(encoded);
    const result = resolveWithinAllowed(decoded, [allowed]);
    expect(result.ok).toBe(false);
  });

  test("rejects an absolute path outside the allowlist", () => {
    const secret = writeFile(outside, "secret.txt");
    const result = resolveWithinAllowed(secret, [allowed]);
    expect(result).toEqual({ ok: false, reason: "outside-allowed" });
  });

  test("rejects a symlink inside the allowlist that points outside it", () => {
    const secret = writeFile(outside, "secret.txt");
    const link = path.join(allowed, "link.mp4");
    fs.symlinkSync(secret, link);
    const result = resolveWithinAllowed(link, [allowed]);
    expect(result).toEqual({ ok: false, reason: "outside-allowed" });
  });

  test("accepts a symlink that resolves to a file inside the allowlist", () => {
    const real = writeFile(allowed, "real.mp4");
    const link = path.join(allowed, "alias.mp4");
    fs.symlinkSync(real, link);
    const result = resolveWithinAllowed(link, [allowed]);
    expect(result).toEqual({ ok: true, realPath: real });
  });

  test("returns not-found for a path that does not exist", () => {
    const result = resolveWithinAllowed(path.join(allowed, "missing.mp4"), [allowed]);
    expect(result).toEqual({ ok: false, reason: "not-found" });
  });

  test("returns invalid for empty input", () => {
    expect(resolveWithinAllowed("", [allowed])).toEqual({ ok: false, reason: "invalid" });
  });

  test("does not treat a sibling sharing a name prefix as inside", () => {
    const sibling = `${allowed}-evil`;
    fs.mkdirSync(sibling, { recursive: true });
    const file = writeFile(sibling, "video.mp4");
    const result = resolveWithinAllowed(file, [allowed]);
    expect(result.ok).toBe(false);
  });

  test("accepts when the file is inside any one of several allowed dirs", () => {
    const file = writeFile(outside, "video.mp4");
    const result = resolveWithinAllowed(file, [allowed, outside]);
    expect(result).toEqual({ ok: true, realPath: file });
  });

  test("ignores empty or non-existent base dirs in the allowlist", () => {
    const file = writeFile(allowed, "video.mp4");
    const result = resolveWithinAllowed(file, ["", path.join(root, "nope"), allowed]);
    expect(result).toEqual({ ok: true, realPath: file });
  });
});
