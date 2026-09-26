export type ListItem = { listId: string; videoId: string };

// The On-device set: the Videos of every List switched on for devices, plus the Phone List.
export const computeOnDeviceSet = (input: {
  switchedOnListIds: string[];
  listItems: ListItem[];
  phoneListVideoIds: string[];
}): Set<string> => {
  const switchedOn = new Set(input.switchedOnListIds);
  return new Set([
    ...input.listItems.filter((item) => switchedOn.has(item.listId)).map((item) => item.videoId),
    ...input.phoneListVideoIds,
  ]);
};

export const videosLeaving = (before: Set<string>, after: Set<string>): string[] =>
  [...before].filter((videoId) => !after.has(videoId));
