import { Alert } from "react-native";
import { heldMovies } from "../../services/held-movies";
import type { HeldTitle } from "../../services/held-movies/types";

/** Long-press on a held Movie or Episode: Remove from this phone, whoever brought it. */
export function confirmRemoveFromThisPhone(title: {
  id: string;
  title: string;
}) {
  Alert.alert("Remove from this phone?", title.title, [
    { text: "Cancel", style: "cancel" },
    {
      text: "Remove",
      style: "destructive",
      onPress: () => void heldMovies.remove(title.id),
    },
  ]);
}

/**
 * Long-press on a Movie card: Download to this phone (the Mirror then never
 * removes it), or Remove from this phone once it is held or on its way.
 */
export function showMovieOptions({
  title,
  held,
  connected,
}: {
  title: HeldTitle;
  /** Held or Downloading on this phone. */
  held: boolean;
  connected: boolean;
}) {
  if (held) return confirmRemoveFromThisPhone(title);
  if (!connected) return;
  Alert.alert(title.title, "Keep it on this phone to watch in Offline mode.", [
    { text: "Cancel", style: "cancel" },
    {
      text: "Download to this phone",
      onPress: () => heldMovies.pull(title),
    },
  ]);
}
