import { audiobookCatalog } from "../audiobook-catalog";
import { heldAudiobooks } from "../held-audiobooks";
import { useAudiobookCatalogStore } from "../../stores/audiobookCatalog";
import { createAudiobookMirror } from "./createAudiobookMirror";

/** Run by the Device mirror on every sync (phone only). */
export const audiobookMirror = createAudiobookMirror({
  loadCatalog: (serverUrl) => audiobookCatalog.served(serverUrl),
  held: heldAudiobooks,
  // A sync follows the desktop's Audiobooks-changed event, so an open phone
  // shows a Listening position the desktop just kept.
  keepCatalog: (serverUrl, audiobooks) => {
    useAudiobookCatalogStore.setState({ serverUrl, audiobooks });
    heldAudiobooks.refresh(audiobooks);
  },
});

export { planAudiobookMirror } from "./planAudiobookMirror";
