import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  createTrackFileAllowlist,
  localFileKey,
  resolveAudiobookTrackFile,
  resolveWithinAllowed,
} from "./path-confinement";

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

describe("resolveAudiobookTrackFile", () => {
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "confine-track-")));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const writeFile = (name: string): string => {
    const p = path.join(root, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "audio");
    return p;
  };

  // The Tracks of imported Audiobooks, as the database holds them.
  const tracks =
    (byId: Record<string, string>) =>
    async (trackId: string): Promise<string | null> =>
      byId[trackId] ?? null;

  test("serves a Track's file by its id, wherever the user's folder is", async () => {
    const file = writeFile("Frankl/CD 1/Track 01.mp3");
    const result = await resolveAudiobookTrackFile("t1", tracks({ t1: file }));
    expect(result).toEqual({ ok: true, realPath: file, contentType: "audio/mpeg" });
  });

  test("names the content type from the Track's extension", async () => {
    const file = writeFile("book.m4b");
    const result = await resolveAudiobookTrackFile("t1", tracks({ t1: file }));
    expect(result).toEqual({ ok: true, realPath: file, contentType: "audio/mp4" });
  });

  test("refuses an id that is not a Track of an imported Audiobook", async () => {
    writeFile("book.mp3");
    const result = await resolveAudiobookTrackFile("t2", tracks({ t1: writeFile("a.mp3") }));
    expect(result).toEqual({ ok: false, reason: "unknown-track" });
  });

  test("refuses a path given in place of a Track id", async () => {
    const other = writeFile("Other/book.mp3");
    const result = await resolveAudiobookTrackFile(other, tracks({ t1: writeFile("a.mp3") }));
    expect(result).toEqual({ ok: false, reason: "unknown-track" });
  });

  test("returns not-found when the Track's file is gone", async () => {
    const result = await resolveAudiobookTrackFile(
      "t1",
      tracks({ t1: path.join(root, "gone.mp3") })
    );
    expect(result).toEqual({ ok: false, reason: "not-found" });
  });

  test("refuses a Track whose file is a symlink to something that is not audio", async () => {
    const notes = writeFile("notes.txt");
    const link = path.join(root, "track.mp3");
    fs.symlinkSync(notes, link);
    const result = await resolveAudiobookTrackFile("t1", tracks({ t1: link }));
    expect(result).toEqual({ ok: false, reason: "not-audio" });
  });

  test("refuses a Track that points at a folder", async () => {
    const dir = path.join(root, "folder.mp3");
    fs.mkdirSync(dir);
    const result = await resolveAudiobookTrackFile("t1", tracks({ t1: dir }));
    expect(result).toEqual({ ok: false, reason: "not-audio" });
  });
});

// An audio file at `name` under `dir`, its folders made as needed.
const writeAudioFile = (dir: string, name: string): string => {
  const p = path.join(dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "audio");
  return p;
};

describe("Track file allowlist", () => {
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "confine-track-path-")));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const writeFile = (name: string): string => writeAudioFile(root, name);

  // The Track files of imported Audiobooks, as the database holds them.
  const trackFiles = (...paths: string[]) => {
    const loads = { count: 0 };
    const load = async (): Promise<string[]> => {
      loads.count += 1;
      return paths;
    };
    return { loads, load };
  };

  test("serves the file of a Track of an imported Audiobook, wherever its folder is", async () => {
    const file = writeFile("Frankl/CD 1/Track 01.mp3");
    const allowlist = createTrackFileAllowlist(trackFiles(file).load);
    expect(await allowlist.resolve(file)).toEqual({
      ok: true,
      realPath: file,
      contentType: "audio/mpeg",
    });
  });

  test("refuses a file that is not a Track, even next to one", async () => {
    const track = writeFile("Frankl/Track 01.mp3");
    const other = writeFile("Frankl/Track 02.mp3");
    const allowlist = createTrackFileAllowlist(trackFiles(track).load);
    expect(await allowlist.resolve(other)).toEqual({ ok: false, reason: "unknown-track" });
  });

  test("matches a Track asked for with .. in its path, and nothing beside it", async () => {
    const track = writeFile("Frankl/Track 01.mp3");
    writeFile("Frankl/Track 02.mp3");
    const allowlist = createTrackFileAllowlist(trackFiles(track).load);
    expect(await allowlist.resolve(path.join(root, "Frankl", "x", "..", "Track 01.mp3"))).toEqual(
      expect.objectContaining({ ok: true })
    );
    expect(await allowlist.resolve(`${track}/../Track 02.mp3`)).toEqual({
      ok: false,
      reason: "unknown-track",
    });
  });

  test("returns not-found when the Track's file is gone", async () => {
    const gone = path.join(root, "gone.mp3");
    const allowlist = createTrackFileAllowlist(trackFiles(gone).load);
    expect(await allowlist.resolve(gone)).toEqual({ ok: false, reason: "not-found" });
  });

  test("refuses a Track whose file is a symlink to something that is not audio", async () => {
    const notes = writeFile("notes.txt");
    const link = path.join(root, "track.mp3");
    fs.symlinkSync(notes, link);
    const allowlist = createTrackFileAllowlist(trackFiles(link).load);
    expect(await allowlist.resolve(link)).toEqual({ ok: false, reason: "not-audio" });
  });

  test("reads the Track files once, not on every request, until Tracks change", async () => {
    const file = writeFile("Frankl/Track 01.mp3");
    const tracks = trackFiles(file);
    const allowlist = createTrackFileAllowlist(tracks.load);

    await Promise.all([allowlist.resolve(file), allowlist.resolve(file)]);
    await allowlist.resolve(file);
    expect(tracks.loads.count).toBe(1);

    allowlist.tracksChanged();
    await allowlist.resolve(file);
    expect(tracks.loads.count).toBe(2);
  });

  test("lets in a Track imported after the first request once Tracks change", async () => {
    const first = writeFile("Frankl/Track 01.mp3");
    const later = writeFile("Orwell/1984.mp3");
    const paths = [first];
    const allowlist = createTrackFileAllowlist(async () => [...paths]);
    expect(await allowlist.resolve(later)).toEqual({ ok: false, reason: "unknown-track" });

    paths.push(later);
    allowlist.tracksChanged();

    expect(await allowlist.resolve(later)).toEqual(expect.objectContaining({ ok: true }));
  });
});

describe("localFileKey", () => {
  test("matches a Windows Track path asked for over local-file:// to the one recorded", () => {
    expect(localFileKey("/C:/Books/Frankl/a.mp3", "win32")).toBe(
      localFileKey("C:\\Books\\Frankl\\a.mp3", "win32")
    );
    expect(localFileKey("/c:/books/frankl/A.MP3", "win32")).toBe(
      localFileKey("C:\\Books\\Frankl\\a.mp3", "win32")
    );
  });

  test("keeps Windows neighbours and other drives apart", () => {
    const track = localFileKey("C:\\Books\\Frankl\\a.mp3", "win32");
    expect(localFileKey("/C:/Books/Frankl/b.mp3", "win32")).not.toBe(track);
    expect(localFileKey("/D:/Books/Frankl/a.mp3", "win32")).not.toBe(track);
  });

  test("is case-sensitive and resolves .. on macOS and Linux", () => {
    expect(localFileKey("/books/Frankl/x/../a.mp3", "darwin")).toBe("/books/Frankl/a.mp3");
    expect(localFileKey("/books/frankl/a.mp3", "linux")).not.toBe(
      localFileKey("/books/Frankl/a.mp3", "linux")
    );
  });
});
