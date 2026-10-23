import type * as http from "http";
import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "@/api/db/schema";
import { createAudiobookSyncRoutes } from "./audiobookSyncRoutes";

const createDb = async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../drizzle") });
  await db.insert(schema.audiobooks).values({
    id: "frankl",
    title: "Man's Search for Meaning",
    sourceFolder: "/books/Frankl",
    sentToDevices: true,
    createdAt: 1,
  });
  await db
    .insert(schema.audiobookTracks)
    .values([{ id: "t1", audiobookId: "frankl", filePath: "/books/Frankl/1.mp3", position: 0 }]);
  return db;
};

const createHarness = async () => {
  const db = await createDb();
  const announced: string[] = [];
  const routes = createAudiobookSyncRoutes({
    db,
    assetUrl: (pathname) => `http://desktop${pathname}`,
    sendJson: () => undefined,
    sendError: () => undefined,
    readBody: async (req) => (req as unknown as { body: string }).body,
    announceAudiobooksChanged: () => announced.push("audiobooks"),
  });
  const postTrackPosition = (body: object): Promise<boolean> =>
    routes.route(
      { method: "POST", body: JSON.stringify(body) } as unknown as http.IncomingMessage,
      { headersSent: false } as http.ServerResponse,
      "/api/audiobook/frankl/track-position"
    );
  return { announced, postTrackPosition };
};

const position = (updatedAt: number) => ({
  audiobookId: "frankl",
  trackId: "t1",
  seconds: 300,
  playedToEnd: false,
  updatedAt,
});

describe("A Device's live Track position", () => {
  it("tells the other Devices when it is kept", async () => {
    const { announced, postTrackPosition } = await createHarness();
    await postTrackPosition(position(2_000));
    expect(announced).toEqual(["audiobooks"]);
  });

  it("stays quiet when an older one loses", async () => {
    const { announced, postTrackPosition } = await createHarness();
    await postTrackPosition(position(2_000));
    await postTrackPosition(position(1_000));
    expect(announced).toEqual(["audiobooks"]);
  });
});
