import type { DesktopBookPlayer } from "./desktopBookPlayer";

/** The parts of `navigator.mediaSession` the Book player drives. */
export type MediaSessionOutput = {
  metadata: MediaMetadata | MediaMetadataInit | null;
  playbackState: MediaSessionPlaybackState;
  setActionHandler: (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => void;
};

const SKIP_SECONDS = 30;

/**
 * Shows the book in the OS media controls and lets them and the keyboard's
 * media keys drive the Book player, also while the window is hidden to the tray.
 */
export function connectMediaSession(
  player: DesktopBookPlayer,
  session: MediaSessionOutput,
  toMetadata: (init: MediaMetadataInit) => MediaMetadata | MediaMetadataInit = (init) =>
    new MediaMetadata(init)
): void {
  // The Track shown, so a pause doesn't rebuild the artwork.
  let shownTrackId: string | null = null;

  const show = (): void => {
    const state = player.getState();
    if (state.status !== "playing" && state.status !== "paused") {
      shownTrackId = null;
      session.metadata = null;
      session.playbackState = "none";
      return;
    }
    const track = state.book.tracks[state.trackIndex];
    if (track && track.id !== shownTrackId) {
      shownTrackId = track.id;
      session.metadata = toMetadata({
        title: track.title,
        artist: state.book.author ?? "",
        album: state.book.title,
        artwork: state.book.coverUrl ? [{ src: state.book.coverUrl }] : [],
      });
    }
    session.playbackState = state.status;
  };

  player.subscribe(show);
  show();

  session.setActionHandler("play", () => player.resume());
  session.setActionHandler("pause", () => player.pause());
  session.setActionHandler("previoustrack", () => void player.previousTrack());
  session.setActionHandler("nexttrack", () => void player.nextTrack());
  session.setActionHandler("seekbackward", () => void player.skip(-SKIP_SECONDS));
  session.setActionHandler("seekforward", () => void player.skip(SKIP_SECONDS));
  session.setActionHandler("seekto", (details) => {
    if (details.seekTime !== undefined) player.seekTo(details.seekTime);
  });
}
