/**
 * The one merge rule for anything shared between the desktop and Devices that
 * carries a change time: the newest `updatedAt` wins; a report no newer than
 * what is there is stale and ignored.
 */
export const newestWins = <T extends { updatedAt: number }>(
  existing: T | null,
  reported: T | null
): T | null => {
  if (!existing) return reported;
  if (!reported) return existing;
  return reported.updatedAt > existing.updatedAt ? reported : existing;
};
