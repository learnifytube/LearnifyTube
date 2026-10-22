import { heldMovies } from "../held-movies";
import { createMovieMirror } from "./createMovieMirror";

/** Run by the Device mirror on every sync, after it refetched the Movie catalog. */
export const movieMirror = createMovieMirror({ held: heldMovies });

export { planMovieMirror, sentTitles } from "./planMovieMirror";
