import { createKeptCaptions } from "./createKeptCaptions";
import { createFakeKeptCaptionsPlatform } from "./fakeKeptCaptionsPlatform";

const SERVER = "http://desktop";

function createHarness() {
  const fake = createFakeKeptCaptionsPlatform({
    served: { en: "WEBVTT en", fr: "WEBVTT fr" },
  });
  return { fake, kept: createKeptCaptions(fake.platform) };
}

describe("kept Captions", () => {
  it("keeps a held title's Captions on the Device, to read with no desktop", async () => {
    const { fake, kept } = createHarness();
    await kept.keep(SERVER, "m1", ["en", "fr"]);

    expect(fake.files()).toEqual(["m1/en", "m1/fr"]);
    expect(await kept.read("m1", "fr")).toBe("WEBVTT fr");
    expect(await kept.read("m1", "de")).toBeNull();
  });

  it("fetches a Caption it already keeps only once", async () => {
    const { fake, kept } = createHarness();
    await kept.keep(SERVER, "m1", ["en"]);
    await kept.keep(SERVER, "m1", ["en", "fr"]);

    expect(fake.fetched()).toEqual([`${SERVER}/en`, `${SERVER}/fr`]);
  });

  it("drops a Caption the desktop no longer pairs with the title", async () => {
    const { fake, kept } = createHarness();
    await kept.keep(SERVER, "m1", ["en", "fr"]);
    await kept.keep(SERVER, "m1", ["fr"]);

    expect(fake.files()).toEqual(["m1/fr"]);
  });

  it("keeps the others when one can't be fetched, and tries it again next time", async () => {
    const { fake, kept } = createHarness();
    await kept.keep(SERVER, "m1", ["gone", "en"]);
    expect(fake.files()).toEqual(["m1/en"]);

    await kept.keep(SERVER, "m1", ["gone", "en"]);
    expect(fake.fetched()).toEqual([
      `${SERVER}/gone`,
      `${SERVER}/en`,
      `${SERVER}/gone`,
    ]);
  });

  it("forgets every Caption of a title that leaves the Device", async () => {
    const { fake, kept } = createHarness();
    await kept.keep(SERVER, "m1", ["en"]);
    await kept.keep(SERVER, "m2", ["fr"]);
    await kept.forget("m1");

    expect(fake.files()).toEqual(["m2/fr"]);
  });
});
