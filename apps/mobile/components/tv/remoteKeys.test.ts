import { decideRemoteKey } from "./remoteKeys";

const KEY_DOWN = 0;
const KEY_UP = 1;

const hidden = { overlayVisible: false, progressFocused: false };
const visible = { overlayVisible: true, progressFocused: false };
const onProgress = { overlayVisible: true, progressFocused: true };

const press = (eventType: string, eventKeyAction = KEY_DOWN) => ({
  eventType,
  eventKeyAction,
});

describe("Remote keys on the TV player", () => {
  it("ignores focus changes and empty events", () => {
    expect(decideRemoteKey({ eventType: "focus" }, visible)).toEqual({
      kind: "ignore",
    });
    expect(decideRemoteKey({ eventType: "blur" }, hidden)).toEqual({
      kind: "ignore",
    });
    expect(decideRemoteKey({}, hidden)).toEqual({ kind: "ignore" });
  });

  describe("while the overlay is hidden", () => {
    it("wakes it on a d-pad press without acting", () => {
      expect(decideRemoteKey(press("left"), hidden)).toEqual({
        kind: "wake",
        suppressPress: false,
      });
    });

    it("wakes it on key up too, since some remotes send only that", () => {
      expect(decideRemoteKey(press("down", KEY_UP), hidden)).toEqual({
        kind: "wake",
        suppressPress: false,
      });
    });

    it("swallows the click of the Select that woke it", () => {
      expect(decideRemoteKey(press("select"), hidden)).toEqual({
        kind: "wake",
        suppressPress: true,
      });
    });

    it("lets media keys act straight away", () => {
      expect(decideRemoteKey(press("rewind"), hidden)).toEqual({
        kind: "seek",
        direction: -1,
      });
      expect(decideRemoteKey(press("playPause"), hidden)).toEqual({
        kind: "show",
      });
      expect(decideRemoteKey(press("fastForward", KEY_UP), hidden)).toEqual({
        kind: "ignore",
      });
    });
  });

  describe("while the overlay is showing", () => {
    it("acts on key down only", () => {
      expect(decideRemoteKey(press("left", KEY_UP), visible)).toEqual({
        kind: "ignore",
      });
    });

    it("keeps it showing as focus moves between buttons", () => {
      expect(decideRemoteKey(press("left"), visible)).toEqual({ kind: "show" });
      expect(decideRemoteKey(press("down"), visible)).toEqual({ kind: "show" });
      expect(decideRemoteKey(press("select"), visible)).toEqual({
        kind: "show",
      });
    });

    it("seeks with left and right on the progress row", () => {
      expect(decideRemoteKey(press("right"), onProgress)).toEqual({
        kind: "seek",
        direction: 1,
      });
      expect(decideRemoteKey(press("KEYCODE_DPAD_LEFT"), onProgress)).toEqual({
        kind: "seek",
        direction: -1,
      });
    });

    it("hides it on up from the progress row, the top of the overlay", () => {
      expect(decideRemoteKey(press("up"), onProgress)).toEqual({
        kind: "hide",
      });
      expect(decideRemoteKey(press("down"), onProgress)).toEqual({
        kind: "show",
      });
    });

    it("leaves play/pause to the media session", () => {
      expect(decideRemoteKey(press("playPause"), visible)).toEqual({
        kind: "show",
      });
    });

    it("seeks with rewind and fast-forward", () => {
      expect(decideRemoteKey(press("fastForward"), visible)).toEqual({
        kind: "seek",
        direction: 1,
      });
    });
  });
});
