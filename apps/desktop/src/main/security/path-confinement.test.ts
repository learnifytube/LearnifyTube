import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  createMovieFileAllowlist,
  createTrackFileAllowlist,
  localFileKey,
  resolveAudiobookTrackFile,
  resolveCaptionFile,
  resolveMovieFile,
  resolveWithinAllowed,
} from "./path-confinement";

// Chromium lowercases the host of a standard-scheme URL, so on macOS
// `local-file://Users/me/a.mp3` arrives as `/users/me/a.mp3`. That still names
// the file only where the file system ignores case.
const caseInsensitiveFs = fs.existsSync(os.tmpdir().toUpperCase());
const testOnCaseInsensitiveFs = caseInsensitiveFs ? test : test.skip;

const UNKNOWN_FILE = { ok: false, reason: "unknown-track" };

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

  testOnCaseInsensitiveFs(
    "accepts a file asked for in another case and returns its real path",
    () => {
      const file = writeFile(allowed, "Video.mp4");
      const result = resolveWithinAllowed(file.toLowerCase(), [allowed]);
      expect(result).toEqual({ ok: true, realPath: file });
    }
  );

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
    expect(result).toEqual(UNKNOWN_FILE);
  });

  test("refuses a path given in place of a Track id", async () => {
    const other = writeFile("Other/book.mp3");
    const result = await resolveAudiobookTrackFile(other, tracks({ t1: writeFile("a.mp3") }));
    expect(result).toEqual(UNKNOWN_FILE);
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

describe("resolveMovieFile", () => {
  let root: string;
  let films: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "confine-movie-")));
    films = path.join(root, "Films");
    fs.mkdirSync(films);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const writeFile = (name: string): string => {
    const p = path.join(root, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "video");
    return p;
  };

  // The Movies Shown on Devices, as the database holds them: file and imported folder.
  const shown =
    (byId: Record<string, string>) =>
    async (id: string): Promise<{ filePath: string; folder: string } | null> =>
      byId[id] ? { filePath: byId[id], folder: films } : null;

  test("serves a Movie's file by its id, inside the folder it was imported from", async () => {
    const file = writeFile("Films/Alien (1979)/Alien.mkv");
    const result = await resolveMovieFile("m1", shown({ m1: file }));
    expect(result).toEqual({ ok: true, realPath: file, contentType: "video/x-matroska" });
  });

  test("refuses an id that isn't a title Shown on Devices", async () => {
    const result = await resolveMovieFile("m2", shown({ m1: writeFile("Films/Up.mp4") }));
    expect(result).toEqual(UNKNOWN_FILE);
  });

  test("returns not-found when the file is gone", async () => {
    const result = await resolveMovieFile("m1", shown({ m1: path.join(films, "gone.mp4") }));
    expect(result).toEqual({ ok: false, reason: "not-found" });
  });

  test("refuses a file that a symlink takes outside the imported folder", async () => {
    const elsewhere = writeFile("Private/home.mp4");
    const link = path.join(films, "Up.mp4");
    fs.symlinkSync(elsewhere, link);
    const result = await resolveMovieFile("m1", shown({ m1: link }));
    expect(result).toEqual({ ok: false, reason: "outside-folder" });
  });

  test("refuses a file that isn't video", async () => {
    const notes = writeFile("Films/notes.txt");
    const result = await resolveMovieFile("m1", shown({ m1: notes }));
    expect(result).toEqual({ ok: false, reason: "not-video" });
  });

  test("serves a Caption's subtitle file by its id, inside the imported folder", async () => {
    const srt = writeFile("Films/Up.en.srt");
    const vtt = writeFile("Films/Up.fr.vtt");
    expect(await resolveCaptionFile("c1", shown({ c1: srt }))).toEqual({
      ok: true,
      realPath: srt,
      contentType: "application/x-subrip",
    });
    expect(await resolveCaptionFile("c2", shown({ c2: vtt }))).toMatchObject({
      contentType: "text/vtt",
    });
    expect(await resolveCaptionFile("c3", shown({ c1: srt }))).toEqual(UNKNOWN_FILE);
  });

  test("refuses a Caption that a symlink takes outside the folder, or that isn't subtitles", async () => {
    const link = path.join(films, "Up.srt");
    fs.symlinkSync(writeFile("Private/diary.srt"), link);
    expect(await resolveCaptionFile("c1", shown({ c1: link }))).toEqual({
      ok: false,
      reason: "outside-folder",
    });
    const film = writeFile("Films/Up.mp4");
    expect(await resolveCaptionFile("c2", shown({ c2: film }))).toEqual({
      ok: false,
      reason: "not-caption",
    });
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

  testOnCaseInsensitiveFs("serves a Track file asked for in another case", async () => {
    const file = writeFile("Frankl/CD 1/Track 01.mp3");
    const allowlist = createTrackFileAllowlist(trackFiles(file).load);
    expect(await allowlist.resolve(file.toLowerCase())).toEqual({
      ok: true,
      realPath: file,
      contentType: "audio/mpeg",
    });
  });

  testOnCaseInsensitiveFs("refuses a file next to a Track asked for in another case", async () => {
    const track = writeFile("Frankl/Track 01.mp3");
    const other = writeFile("Frankl/Track 02.mp3");
    const allowlist = createTrackFileAllowlist(trackFiles(track).load);
    expect(await allowlist.resolve(other.toLowerCase())).toMatchObject({ ok: false });
  });

  test("refuses a file that is not a Track, even next to one", async () => {
    const track = writeFile("Frankl/Track 01.mp3");
    const other = writeFile("Frankl/Track 02.mp3");
    const allowlist = createTrackFileAllowlist(trackFiles(track).load);
    expect(await allowlist.resolve(other)).toEqual(UNKNOWN_FILE);
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
    expect(await allowlist.resolve(later)).toEqual(UNKNOWN_FILE);

    paths.push(later);
    allowlist.tracksChanged();

    expect(await allowlist.resolve(later)).toEqual(expect.objectContaining({ ok: true }));
  });

  test("serves the video file of a Movie, and nothing beside it", async () => {
    const film = writeFile("Films/Alien (1979)/Alien.1979.mkv");
    const other = writeFile("Films/Alien (1979)/Alien.1979.nfo");
    const allowlist = createMovieFileAllowlist(trackFiles(film, other).load);
    expect(await allowlist.resolve(film)).toEqual({
      ok: true,
      realPath: film,
      contentType: "video/x-matroska",
    });
    expect(await allowlist.resolve(other)).toEqual({ ok: false, reason: "not-video" });
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
