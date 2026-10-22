// Pushes the Movies sync event (`sync:movies`) so connected Devices refetch the
// Movie catalog now: on Shown on Devices, Send to Devices, and any other change
// to what the catalog lists.
export const broadcastMoviesChanged = async (): Promise<void> => {
  try {
    const { getMobileSyncServer } = await import("@/main/mobileSyncServer");
    getMobileSyncServer().broadcastMoviesChanged();
  } catch {
    // The sync server isn't running here; Devices pick it up at their next sync.
  }
};
