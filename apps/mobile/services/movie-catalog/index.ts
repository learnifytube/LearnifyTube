import { api } from "../api";
import { useMovieCatalogStore } from "../../stores/movieCatalog";
import { createMovieCatalog } from "./createMovieCatalog";

export const movieCatalog = createMovieCatalog({
  getInfo: (serverUrl) => api.getInfo(serverUrl),
  getMovies: (serverUrl) => api.getMovies(serverUrl),
});

/**
 * Loads the desktop's Movies and Series into the Catalog snapshot: on Home
 * focus, and on every Device mirror sync (so on the `sync:movies` event).
 */
export const refreshMovieCatalog = async (serverUrl: string) => {
  const served = await movieCatalog.served(serverUrl);
  const { movies, series } = served ?? { movies: [], series: [] };
  useMovieCatalogStore.setState({ serverUrl, movies, series });
  // Null on a desktop too old to serve Movies, so the Movie Mirror leaves the Device alone.
  return served;
};
