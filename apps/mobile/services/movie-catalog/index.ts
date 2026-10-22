import { api } from "../api";
import { createMovieCatalog } from "./createMovieCatalog";

export const movieCatalog = createMovieCatalog({
  getInfo: (serverUrl) => api.getInfo(serverUrl),
  getMovies: (serverUrl) => api.getMovies(serverUrl),
});
