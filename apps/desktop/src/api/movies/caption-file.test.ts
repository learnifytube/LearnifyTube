import fs from "fs";
import os from "os";
import path from "path";
import { readCaptionAsWebVtt } from "./caption-file";

describe("readCaptionAsWebVtt", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "captions-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (name: string, bytes: Buffer): string => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, bytes);
    return file;
  };

  it("serves an SRT file as WebVTT, reading UTF-8 and older Windows-1252 files", async () => {
    const srt = "1\n00:00:01,000 --> 00:00:02,000\nCafé\n";
    const expected = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nCafé\n";
    expect(await readCaptionAsWebVtt(write("a.srt", Buffer.from(srt, "utf8")))).toBe(expected);
    expect(await readCaptionAsWebVtt(write("b.srt", Buffer.from(srt, "latin1")))).toBe(expected);
  });
});
