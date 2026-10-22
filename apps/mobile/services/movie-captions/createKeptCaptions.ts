export type KeptCaptionsPlatform = {
  /** GET /api/caption/:id: the Caption as WebVTT. */
  fetchCaption: (serverUrl: string, captionId: string) => Promise<string>;
  /** The ids of the Captions kept for a title. */
  list: (titleId: string) => Promise<string[]>;
  write: (titleId: string, captionId: string, text: string) => Promise<void>;
  /** A kept Caption's text, or null when it isn't kept. */
  read: (titleId: string, captionId: string) => Promise<string | null>;
  remove: (titleId: string, captionId: string) => Promise<void>;
  removeAll: (titleId: string) => Promise<void>;
};

/**
 * The Captions of each Movie or Episode held on this Device, kept beside its
 * Offline copy so a held title shows Captions in Offline mode too. They live
 * as long as the hold: the Mirror keeps them in step with the desktop's
 * pairing on every sync, and removing the title forgets them.
 */
export function createKeptCaptions(platform: KeptCaptionsPlatform) {
  /** Fetches the title's Captions not kept yet and drops those no longer paired. */
  const keep = async (
    serverUrl: string,
    titleId: string,
    captionIds: string[],
  ): Promise<void> => {
    const kept = await platform.list(titleId);
    for (const captionId of kept) {
      if (!captionIds.includes(captionId)) {
        await platform.remove(titleId, captionId);
      }
    }
    for (const captionId of captionIds) {
      if (kept.includes(captionId)) continue;
      try {
        const text = await platform.fetchCaption(serverUrl, captionId);
        await platform.write(titleId, captionId, text);
      } catch (error) {
        // Asked for again at the next sync.
        console.warn("[captions] Couldn't keep a Caption:", error);
      }
    }
  };

  return {
    keep,
    read: (titleId: string, captionId: string): Promise<string | null> =>
      platform.read(titleId, captionId).catch(() => null),
    /** The title left this Device: its Captions go with it. */
    forget: (titleId: string): Promise<void> => platform.removeAll(titleId),
  };
}

export type KeptCaptions = ReturnType<typeof createKeptCaptions>;
