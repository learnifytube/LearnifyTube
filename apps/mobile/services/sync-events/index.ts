import { fetch } from "expo/fetch";
import { createSseParser } from "./createSseParser";

const RECONNECT_DELAY_MS = 5_000;

/**
 * Listens to the desktop's sync events (`/api/events`), reconnecting while
 * open. React Native has no EventSource, so this reads the stream with
 * expo/fetch. Returns a function that stops listening.
 */
export function listenToSyncEvents(
  url: string,
  onEvent: (event: string) => void,
) {
  let closed = false;
  let controller: AbortController | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const connect = async () => {
    controller = new AbortController();
    try {
      const response = await fetch(url, {
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = createSseParser(onEvent);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
    } catch {
      // The desktop went away or the stream broke; the sync interval still
      // runs, and this tries again shortly.
    }
    if (!closed) retry = setTimeout(connect, RECONNECT_DELAY_MS);
  };

  void connect();
  return () => {
    closed = true;
    if (retry) clearTimeout(retry);
    controller?.abort();
  };
}
