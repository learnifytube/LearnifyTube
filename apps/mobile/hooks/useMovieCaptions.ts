import { useEffect, useState } from "react";
import type { VideoPlayer } from "expo-video";
import type { Caption } from "../../shared/mobile-sync-contract";
import { currentCaption } from "../components/captions";
import { captionCues, nextCaption } from "../services/movie-captions";
import { useConnectionStore } from "../stores/connection";
import { useSettingsStore } from "../stores/settings";
import type { TranscriptSegment } from "../types";

/**
 * A Movie's or Episode's sidecar Captions in the phone and TV players: off
 * until the viewer presses the Captions button, which then steps through the
 * languages (the viewer's own first) and back to off. `text` is the line on
 * screen now, at most `maxChars` long.
 */
export function useMovieCaptions(
  player: VideoPlayer,
  titleId: string,
  captions: Caption[],
  maxChars = Infinity,
) {
  const serverUrl = useConnectionStore((state) => state.serverUrl);
  const preferred = useSettingsStore((state) => state.translationTargetLang);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    captions.find((caption) => caption.id === selectedId) ?? null;
  const [loaded, setLoaded] = useState<{
    id: string;
    segments: TranscriptSegment[];
  } | null>(null);
  const [text, setText] = useState<string | null>(null);

  // The lines kept with a held title, else the desktop's while one is connected.
  const shownId = selected?.id ?? null;
  useEffect(() => {
    if (!shownId) return;
    let current = true;
    void captionCues.load(serverUrl, titleId, shownId).then((segments) => {
      if (current) setLoaded({ id: shownId, segments });
    });
    return () => {
      current = false;
    };
  }, [shownId, serverUrl, titleId]);

  const segments = shownId && loaded?.id === shownId ? loaded.segments : null;
  useEffect(() => {
    if (!segments) return;
    setText(currentCaption(segments, player.currentTime, maxChars));
    const subscription = player.addListener("timeUpdate", (event) =>
      setText(currentCaption(segments, event.currentTime, maxChars)),
    );
    return () => subscription.remove();
  }, [player, segments, maxChars]);

  return {
    /** Whether the title has Captions to turn on. */
    available: captions.length > 0,
    /** The Caption showing, or null when Captions are off. */
    selected,
    text: segments ? text : null,
    /** One press of the Captions button. */
    next: () =>
      setSelectedId(
        nextCaption(captions, selected?.id ?? null, preferred)?.id ?? null,
      ),
  };
}
