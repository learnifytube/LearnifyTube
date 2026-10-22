import { api } from "../api";
import { createCaptionCues } from "./createCaptionCues";

export { nextCaption } from "./captionChoice";

export const captionCues = createCaptionCues({
  getCaption: (serverUrl, captionId) => api.getCaption(serverUrl, captionId),
});
