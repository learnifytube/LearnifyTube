/**
 * What the player does when the desktop drops out while it streams a Video: play the
 * TV's Offline copy, else the next Video in the queue the TV holds, else go back.
 */
export function planDesktopLoss({
  videoId,
  queue,
  index,
  hasOfflineCopy,
}: {
  videoId: string;
  queue: readonly { id: string }[];
  index: number;
  hasOfflineCopy: (videoId: string) => boolean;
}) {
  if (hasOfflineCopy(videoId)) return { kind: "offlineCopy" } as const;
  if (index >= 0) {
    for (let next = index + 1; next < queue.length; next += 1) {
      if (hasOfflineCopy(queue[next].id))
        return { kind: "next", index: next } as const;
    }
  }
  return { kind: "back" } as const;
}
