import { audiobookCatalog } from "../audiobook-catalog";
import { heldAudiobooks } from "../held-audiobooks";
import { createAudiobookMirror } from "./createAudiobookMirror";

/** Run by the Device mirror on every sync (phone only). */
export const audiobookMirror = createAudiobookMirror({
  loadCatalog: (serverUrl) => audiobookCatalog.served(serverUrl),
  held: heldAudiobooks,
});

export { planAudiobookMirror } from "./planAudiobookMirror";
