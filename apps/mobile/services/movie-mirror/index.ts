import { heldMovies } from "../held-movies";
import { keptCaptions } from "../movie-captions";
import { createMovieMirror } from "./createMovieMirror";

/** Run by the Device mirror on every sync, after it refetched the Movie catalog. */
export const movieMirror = createMovieMirror({
  held: heldMovies,
  captions: keptCaptions,
});

export { planMovieMirror, sentTitles } from "./planMovieMirror";
