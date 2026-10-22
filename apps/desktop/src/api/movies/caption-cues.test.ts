import { parseCaptionCues, toWebVtt } from "../../../../shared/captions/captionCues";

// Shared with the phone and TV, which read what GET /api/caption/:id serves.

const SRT = `\uFEFF1
00:00:01,000 --> 00:00:03,500
Hello <i>there</i>.
How are you?

2
00:01:02,250 --> 00:01:04,000 X1:0 X2:0
{\\an8}<font color="#fff">Fine</font>

3
not a cue
`;

const VTT = `WEBVTT
Kind: captions

NOTE a comment

intro
00:01.000 --> 00:03.500 align:start
<c.yellow>Hello</c> &amp; welcome

01:00:00.000 --> 01:00:02.000
<v Roger>Bye
`;

describe("Caption cues", () => {
  it("reads an SRT file: times, lines, and no styling", () => {
    expect(parseCaptionCues(SRT)).toEqual([
      { start: 1, end: 3.5, text: "Hello there.\nHow are you?" },
      { start: 62.25, end: 64, text: "Fine" },
    ]);
  });

  it("reads a WebVTT file, with short times and cue ids", () => {
    expect(parseCaptionCues(VTT)).toEqual([
      { start: 1, end: 3.5, text: "Hello & welcome" },
      { start: 3600, end: 3602, text: "Bye" },
    ]);
  });

  it("reads Windows line endings, and nothing from an empty file", () => {
    expect(parseCaptionCues(SRT.replace(/\n/g, "\r\n"))).toHaveLength(2);
    expect(parseCaptionCues("")).toEqual([]);
  });

  it("writes cues as WebVTT that reads back the same", () => {
    expect(parseCaptionCues(toWebVtt([{ start: 0, end: 1, text: "a < b & c" }]))).toEqual([
      { start: 0, end: 1, text: "a < b & c" },
    ]);
    const cues = parseCaptionCues(SRT);
    const vtt = toWebVtt(cues);
    expect(vtt).toBe(
      "WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nHello there.\nHow are you?\n\n00:01:02.250 --> 00:01:04.000\nFine\n"
    );
    expect(parseCaptionCues(vtt)).toEqual(cues);
  });
});
