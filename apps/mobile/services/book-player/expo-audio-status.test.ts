import { createExpoAudioStatusReader } from "./expoAudioStatus";

// What expo-audio's playbackStatusUpdate events mean for the Book player.
// Android reports no errors for a Track that 404s, only states.

type Status = Parameters<
  ReturnType<typeof createExpoAudioStatusReader>["read"]
>[0];

const status = (overrides: Partial<Status>): Status => ({
  playbackState: "ready",
  playing: true,
  didJustFinish: false,
  ...overrides,
});

describe("expo-audio status reader", () => {
  it("reports the end of a Track", () => {
    const reader = createExpoAudioStatusReader(() => 0);

    expect(
      reader.read(status({ didJustFinish: true, playing: false })),
    ).toEqual(["ended"]);
  });

  it("reports a Track ready once it has loaded after a replace", () => {
    const reader = createExpoAudioStatusReader(() => 0);
    reader.loading();
    reader.commanded(true);

    // A status from the previous Track, still in flight.
    expect(reader.read(status({ playbackState: "ready" }))).toEqual([]);
    expect(reader.read(status({ playbackState: "buffering" }))).toEqual([]);
    expect(reader.read(status({ playbackState: "ready" }))).toEqual(["ready"]);
    expect(reader.read(status({ playbackState: "ready" }))).toEqual([]);
  });

  it("reports a Track failed when it drops back to idle while loading (a 404)", () => {
    const reader = createExpoAudioStatusReader(() => 0);
    reader.loading();

    reader.read(status({ playbackState: "buffering" }));

    expect(
      reader.read(status({ playbackState: "idle", playing: false })),
    ).toEqual(["failed"]);
  });

  it("reports a Track failed when it drops to idle while playing", () => {
    const reader = createExpoAudioStatusReader(() => 0);
    reader.loading();
    reader.read(status({ playbackState: "buffering" }));
    reader.read(status({ playbackState: "ready" }));

    expect(
      reader.read(status({ playbackState: "idle", playing: false })),
    ).toEqual(["failed"]);
  });

  it("says nothing about idle after the player was stopped", () => {
    const reader = createExpoAudioStatusReader(() => 0);
    reader.loading();
    reader.read(status({ playbackState: "buffering" }));
    reader.read(status({ playbackState: "ready" }));

    reader.stopped();

    expect(
      reader.read(status({ playbackState: "idle", playing: false })),
    ).toEqual([]);
  });

  it("reports the system pausing and resuming a ready Track", () => {
    let now = 0;
    const reader = createExpoAudioStatusReader(() => now);
    reader.commanded(true);
    now = 5_000;

    expect(reader.read(status({ playing: false }))).toEqual([
      { playing: false },
    ]);
    expect(reader.read(status({ playing: false }))).toEqual([]);
    expect(reader.read(status({ playing: true }))).toEqual([{ playing: true }]);
  });

  it("ignores play state while a Track is buffering", () => {
    let now = 0;
    const reader = createExpoAudioStatusReader(() => now);
    reader.commanded(true);
    now = 5_000;

    expect(
      reader.read(status({ playbackState: "buffering", playing: false })),
    ).toEqual([]);
  });

  it("ignores stale play state that arrives just after the app's own play or pause", () => {
    let now = 0;
    const reader = createExpoAudioStatusReader(() => now);
    reader.commanded(true);
    now = 5_000;
    reader.commanded(false);
    now = 5_200;

    // Emitted before the pause reached the native player.
    expect(reader.read(status({ playing: true }))).toEqual([]);
    now = 7_000;
    expect(reader.read(status({ playing: false }))).toEqual([]);
  });
});
