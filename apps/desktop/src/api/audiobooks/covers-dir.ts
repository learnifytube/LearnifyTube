import path from "node:path";

// Covers are copied into app storage so the renderer and Devices can be served
// them without reaching into the user's folders.
export const audiobookCoversDir = (userData: string): string =>
  path.join(userData, "audiobook-covers");
