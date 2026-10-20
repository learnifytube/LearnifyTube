import type { Audiobook } from "../../../shared/mobile-sync-contract";
import { createHeldAudiobooks } from "../held-audiobooks/createHeldAudiobooks";
import { createFakeHeldAudiobooksPlatform } from "../held-audiobooks/fakeHeldAudiobooksPlatform";
import { createAudiobookMirror } from "./createAudiobookMirror";

const SERVER = "http://desktop";

const track = (id: string, missing = false) => ({
  id,
  title: `Track ${id}`,
  durationSeconds: 300,
  missing,
});

const book = (
  id: string,
  trackIds: string[],
  sentToDevices: boolean,
): Audiobook => ({
  id,
  title: id,
  author: null,
  coverUrl: null,
  tracks: trackIds.map((trackId) => track(trackId)),
  listeningPosition: null,
  finished: false,
  sentToDevices,
});

function createHarness() {
  const fake = createFakeHeldAudiobooksPlatform({ serverUrl: SERVER });
  const held = createHeldAudiobooks(fake.platform);
  held.start();
  let catalog: Audiobook[] | null = [];
  const mirror = createAudiobookMirror({
    loadCatalog: async () => catalog,
    held,
  });
  const desktopServes = (books: Audiobook[] | null) => {
    catalog = books;
  };
  const sync = async () => {
    await mirror.mirror(SERVER);
    await held.idle();
  };
  return { fake, held, mirror, desktopServes, sync };
}

describe("Audiobook Mirror", () => {
  it("fetches every Track of a sent Audiobook without the user opening it", async () => {
    const { fake, held, mirror, desktopServes, sync } = createHarness();
    desktopServes([
      book("orwell", ["intro", "book"], true),
      book("frankl", ["cd1"], false),
    ]);

    await sync();

    expect(fake.fetched()).toEqual(["orwell/intro", "orwell/book"]);
    expect(held.getHold("orwell")).toMatchObject({
      reasons: ["mirrored"],
      complete: true,
    });
    expect(await mirror.heldIds()).toEqual(["orwell"]);
  });

  it("removes the Audiobook at the next Mirror once it is removed from Devices", async () => {
    const { fake, held, desktopServes, sync } = createHarness();
    desktopServes([book("orwell", ["intro", "book"], true)]);
    await sync();

    desktopServes([book("orwell", ["intro", "book"], false)]);
    await sync();

    expect(held.getHold("orwell")).toBeNull();
    expect(fake.files()).toEqual([]);
  });

  it("removes the mirrored copy of a sent Audiobook forgotten on the desktop", async () => {
    const { held, desktopServes, sync } = createHarness();
    desktopServes([book("orwell", ["intro", "book"], true)]);
    await sync();

    desktopServes([]);
    await sync();

    expect(held.getHold("orwell")).toBeNull();
  });

  it("keeps an Audiobook the user pulled by playing it when it stops being sent", async () => {
    const { held, desktopServes, sync } = createHarness();
    const frankl = book("frankl", ["cd1", "cd3"], false);
    held.pull(frankl);
    await held.idle();

    desktopServes([{ ...frankl, sentToDevices: true }]);
    await sync();
    desktopServes([frankl]);
    await sync();

    expect(held.getHold("frankl")).toMatchObject({
      reasons: ["pulled"],
      complete: true,
    });
  });

  it("changes nothing on a desktop too old to serve Audiobooks", async () => {
    const { held, desktopServes, sync } = createHarness();
    desktopServes([book("orwell", ["intro"], true)]);
    await sync();

    desktopServes(null);
    await sync();

    expect(held.getHold("orwell")).toMatchObject({ reasons: ["mirrored"] });
  });

  it("reports only Audiobooks wholly on the phone as held", async () => {
    const { fake, mirror, desktopServes } = createHarness();
    desktopServes([book("orwell", ["intro", "book"], true)]);
    fake.setServerUrl(null);

    await mirror.mirror(SERVER);

    expect(await mirror.heldIds()).toEqual([]);
  });
});
