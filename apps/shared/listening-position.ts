/**
 * The one merge rule for an Audiobook's Listening position, used by the desktop
 * and Devices alike: the newest `updatedAt` wins; a report no newer than what is
 * there is stale and ignored.
 */
export const newestListening = <T extends { updatedAt: number }>(
  existing: T | null,
  reported: T | null
): T | null => {
  if (!existing) return reported;
  if (!reported) return existing;
  return reported.updatedAt > existing.updatedAt ? reported : existing;
};
