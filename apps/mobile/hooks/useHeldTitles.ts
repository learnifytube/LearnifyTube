import { useMemo } from "react";
import { heldMovies, type MovieHold } from "../services/held-movies";
import { movieOfflineCopy } from "../services/offline-copy";

/**
 * The Movies and Episodes whose Offline copy is on this Device now, newest
 * first. The same array until a hold or an Offline copy changes, since the TV
 * home's grid keys its paging and focus off its cards' identity.
 */
export function useHeldTitles(): MovieHold[] {
  const holds = heldMovies.useHolds();
  const getUri = movieOfflineCopy.useLookup();
  return useMemo(
    () => holds.filter((hold) => getUri(hold.id) !== null),
    [holds, getUri],
  );
}
