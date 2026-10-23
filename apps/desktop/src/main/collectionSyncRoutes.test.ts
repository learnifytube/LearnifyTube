import type * as http from "http";
import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "@/api/db/schema";
import { COLLECTION_CURRENT_VIDEO_PATH } from "../../../shared/mobile-sync-contract";
import { createCollectionSyncRoutes } from "./collectionSyncRoutes";

const createHarness = async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../drizzle") });
  await db.insert(schema.youtubeVideos).values(
    ["a", "b"].map((videoId) => ({
      id: videoId,
      videoId,
      title: videoId,
      channelTitle: "Channel",
      createdAt: 1,
    }))
  );
  await db.insert(schema.customPlaylists).values({ id: "trip", name: "Trip", createdAt: 1 });
  const announced: string[] = [];
  const routes = createCollectionSyncRoutes({
    db,
    sendJson: () => undefined,
    sendError: () => undefined,
    readBody: async (req) => (req as unknown as { body: string }).body,
    announceCurrentVideosChanged: () => announced.push("current-videos"),
  });
  const postCurrentVideo = (videoId: string, updatedAt: number): Promise<boolean> =>
    routes.route(
      {
        method: "POST",
        body: JSON.stringify({
          collectionKind: "list",
          collectionId: "trip",
          videoId,
          updatedAt,
        }),
      } as unknown as http.IncomingMessage,
      {} as http.ServerResponse,
      COLLECTION_CURRENT_VIDEO_PATH
    );
  return { announced, postCurrentVideo };
};

describe("A Device's live Current Video", () => {
  it("tells the other Devices when it is kept", async () => {
    const { announced, postCurrentVideo } = await createHarness();
    await postCurrentVideo("b", 2_000);
    expect(announced).toEqual(["current-videos"]);
  });

  it("stays quiet when an older one loses", async () => {
    const { announced, postCurrentVideo } = await createHarness();
    await postCurrentVideo("b", 2_000);
    await postCurrentVideo("a", 1_000);
    expect(announced).toEqual(["current-videos"]);
  });
});
