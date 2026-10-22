import path from "node:path";

// Posters are copied or grabbed into app storage, like Audiobook covers, so the
// renderer and Devices are served them without reaching into the user's folders.
export const moviePostersDir = (userData: string): string => path.join(userData, "movie-posters");
