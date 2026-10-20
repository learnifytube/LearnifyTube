import { desc, eq } from "drizzle-orm";
import type { Database } from "@/api/db";
import { audiobooks, syncDevices } from "@/api/db/schema";

export type AudiobookDevice = {
  id: string;
  name: string;
  kind: (typeof syncDevices.$inferSelect)["kind"];
  lastSeenAt: number;
};

/**
 * Sends the whole Audiobook to Devices, or removes it from them; Devices
 * Mirror it at their next sync. Returns whether anything changed.
 */
export const setAudiobookSentToDevices = async (
  db: Database,
  audiobookId: string,
  sent: boolean
): Promise<boolean> => {
  const [book] = await db
    .select({ sentToDevices: audiobooks.sentToDevices })
    .from(audiobooks)
    .where(eq(audiobooks.id, audiobookId));
  if (!book || book.sentToDevices === sent) return false;
  // updated_at is left alone: it versions the cover URL.
  await db.update(audiobooks).set({ sentToDevices: sent }).where(eq(audiobooks.id, audiobookId));
  return true;
};

/** The Devices that last reported holding the whole Audiobook, most recently seen first. */
export const devicesHoldingAudiobook = async (
  db: Database,
  audiobookId: string
): Promise<AudiobookDevice[]> => {
  const devices = await db.select().from(syncDevices).orderBy(desc(syncDevices.lastSeenAt));
  return devices
    .filter((device) => {
      const held: unknown = JSON.parse(device.heldAudiobookIdsJson);
      return Array.isArray(held) && held.includes(audiobookId);
    })
    .map((device) => ({
      id: device.id,
      name: device.name,
      kind: device.kind,
      lastSeenAt: device.lastSeenAt,
    }));
};
