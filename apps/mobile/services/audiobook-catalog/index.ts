import { api } from "../api";
import { createAudiobookCatalog } from "./createAudiobookCatalog";

export const audiobookCatalog = createAudiobookCatalog({
  getInfo: (serverUrl) => api.getInfo(serverUrl),
  getAudiobooks: (serverUrl) => api.getAudiobooks(serverUrl),
});
