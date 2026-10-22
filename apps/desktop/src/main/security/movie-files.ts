import defaultDb from "../../api/db";
import { listMovieFilePaths } from "../../api/movies/catalog";
import { createMovieFileAllowlist } from "./path-confinement";

/**
 * The Movie and Episode video files `local-file://` lets through. The Movies
 * router calls `tracksChanged` whenever it adds or removes a Movie or Episode.
 */
export const movieFiles = createMovieFileAllowlist(() => listMovieFilePaths(defaultDb));
