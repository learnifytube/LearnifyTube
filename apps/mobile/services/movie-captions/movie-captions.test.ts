import type { Caption } from "../../../shared/mobile-sync-contract";
import { nextCaption } from "./captionChoice";
import { createCaptionCues } from "./createCaptionCues";

const english: Caption = { id: "en", language: "en", label: "English" };
const french: Caption = { id: "fr", language: "fr", label: "French" };
const brazilian: Caption = {
  id: "pt",
  language: "pt-BR",
  label: "Brazilian Portuguese",
};
const untagged: Caption = { id: "x", language: null, label: "Captions" };

describe("nextCaption", () => {
  it("turns a single Caption on and off, like Video Captions", () => {
    expect(nextCaption([english], null, null)).toBe(english);
    expect(nextCaption([english], "en", null)).toBeNull();
  });

  it("goes through every language and then off", () => {
    const captions = [english, french, untagged];
    expect(nextCaption(captions, null, null)).toBe(english);
    expect(nextCaption(captions, "en", null)).toBe(french);
    expect(nextCaption(captions, "fr", null)).toBe(untagged);
    expect(nextCaption(captions, "x", null)).toBeNull();
  });

  it("starts with the viewer's language when there is one", () => {
    const captions = [english, french, brazilian];
    expect(nextCaption(captions, null, "fr")).toBe(french);
    expect(nextCaption(captions, "fr", "fr")).toBe(english);
    expect(nextCaption(captions, "en", "fr")).toBe(brazilian);
    expect(nextCaption(captions, "pt", "fr")).toBeNull();
    // pt-BR is Portuguese.
    expect(nextCaption(captions, null, "pt")).toBe(brazilian);
  });

  it("has nothing to turn on without Captions, and starts over from one that went", () => {
    expect(nextCaption([], null, null)).toBeNull();
    expect(nextCaption([french], "gone", null)).toBe(french);
  });
});

const VTT = `WEBVTT

00:00:01.000 --> 00:00:02.500
Hello &amp; welcome

00:00:03.000 --> 00:00:04.000
Bye
`;

function createHarness() {
  const requests: string[] = [];
  let failNext = false;
  const cues = createCaptionCues({
    getCaption: async (serverUrl, captionId) => {
      requests.push(`${serverUrl}/${captionId}`);
      if (failNext) {
        failNext = false;
        throw new Error("HTTP 503");
      }
      return VTT;
    },
  });
  return {
    cues,
    requests,
    failOnce: () => {
      failNext = true;
    },
  };
}

describe("createCaptionCues", () => {
  it("reads a Caption the desktop serves as timed lines", async () => {
    const { cues } = createHarness();
    expect(await cues.load("http://desktop", "en")).toEqual([
      { start: 1, end: 2.5, text: "Hello & welcome" },
      { start: 3, end: 4, text: "Bye" },
    ]);
  });

  it("fetches each Caption once", async () => {
    const { cues, requests } = createHarness();
    await cues.load("http://desktop", "en");
    await cues.load("http://desktop", "en");
    await cues.load("http://desktop", "fr");
    expect(requests).toEqual(["http://desktop/en", "http://desktop/fr"]);
  });

  it("shows nothing when the desktop can't be reached, and asks again next time", async () => {
    const { cues, requests, failOnce } = createHarness();
    failOnce();
    expect(await cues.load("http://desktop", "en")).toEqual([]);
    expect(await cues.load("http://desktop", "en")).toHaveLength(2);
    expect(requests).toHaveLength(2);
  });
});
