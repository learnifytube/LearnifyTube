// Tells connected Devices the Movies catalog changed (sent titles, Shown on
// Devices, missing files); Devices not connected pick it up at their next sync.
export const notifyDevicesOfMovies = async (): Promise<void> => {
  try {
    const { getMobileSyncServer } = await import("@/main/mobileSyncServer");
    getMobileSyncServer().broadcastMoviesChanged();
  } catch {
    // The sync server isn't running here.
  }
};
