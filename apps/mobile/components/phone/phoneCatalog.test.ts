import {
  buildPhoneHome,
  CONTINUE_WATCHING_ID,
  SENT_TO_THIS_PHONE_ID,
  type PhoneHomeInput,
} from "./phoneCatalog";
import type { StreamingVideo } from "../../stores/playback";

const video = (id: string): StreamingVideo => ({
  id,
  title: `Video ${id}`,
  channelTitle: "Lab",
  duration: 60,
  thumbnailUrl: `thumb-${id}`,
});

const base = (overrides: Partial<PhoneHomeInput> = {}): PhoneHomeInput => ({
  connected: true,
  hasOfflineCopy: () => false,
  getStoredThumbnail: () => null,
  resolveAssetUrl: (url) => url ?? null,
  continueWatching: [],
  onDeviceSet: [],
  channels: [],
  lists: [],
  playlists: [],
  ...overrides,
});

describe("buildPhoneHome", () => {
  it("orders Continue, Sent to this phone, Channels, Lists, then YouTube playlists", () => {
    const rows = buildPhoneHome(
      base({
        continueWatching: [
          { ...video("c1"), lastPositionSeconds: 10, lastWatchedAt: 1 },
        ],
        onDeviceSet: [
          {
            id: "s1",
            title: "Sent",
            channelTitle: "Lab",
            duration: 20,
            thumbnailUrl: null,
          },
        ],
        channels: [
          {
            channel: {
              channelId: "ch1",
              channelTitle: "Science",
              thumbnailUrl: null,
              videoCount: 1,
            },
            videos: [video("v1")],
          },
        ],
        lists: [
          {
            list: {
              id: "l1",
              name: "Bedtime",
              itemCount: 1,
              thumbnailUrl: null,
              sourceType: "custom_playlist",
              sourceId: "l1",
              isFavorite: false,
            },
            videos: [video("v2")],
          },
        ],
        playlists: [
          {
            playlist: {
              playlistId: "p1",
              title: "Science for kids",
              thumbnailUrl: null,
              itemCount: 1,
              channelId: null,
              type: "channel",
              downloadedCount: 1,
            },
            videos: [video("v3")],
          },
        ],
      }),
    );

    expect(rows.map((row) => row.id)).toEqual([
      CONTINUE_WATCHING_ID,
      SENT_TO_THIS_PHONE_ID,
      "channel-ch1",
      "list-l1",
      "playlist-p1",
    ]);
  });

  it("keeps only Offline copies when not connected", () => {
    const rows = buildPhoneHome(
      base({
        connected: false,
        hasOfflineCopy: (id) => id === "held",
        channels: [
          {
            channel: {
              channelId: "ch1",
              channelTitle: "Science",
              thumbnailUrl: null,
              videoCount: 2,
            },
            videos: [video("held"), video("stream-only")],
          },
        ],
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].videos.map((item) => item.id)).toEqual(["held"]);
  });

  it("omits empty rows", () => {
    const rows = buildPhoneHome(
      base({
        connected: false,
        channels: [
          {
            channel: {
              channelId: "ch1",
              channelTitle: "Science",
              thumbnailUrl: null,
              videoCount: 1,
            },
            videos: [video("missing")],
          },
        ],
      }),
    );
    expect(rows).toEqual([]);
  });
});
