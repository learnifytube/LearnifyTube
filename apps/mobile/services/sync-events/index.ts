import { fetch } from "expo/fetch";
import { SYNC_SSE_HEARTBEAT_MS } from "../../../shared/mobile-sync-contract";
import { createSseParser } from "./createSseParser";

const RECONNECT_DELAY_MS = 5_000;
// A stream with nothing for this long has silently dropped (Wi-Fi gone, the
// desktop asleep); a desktop too old to send heartbeats just reconnects.
const IDLE_TIMEOUT_MS = 3 * SYNC_SSE_HEARTBEAT_MS;

/**
 * Listens to the desktop's sync events (`/api/events`), reconnecting while
 * open. React Native has no EventSource, so this reads the stream with
 * expo/fetch. Returns a function that stops listening.
 */
export function listenToSyncEvents(
  url: string,
  handlers: { onEvent: (event: string) => void; onReconnect: () => void },
) {
  let closed = false;
  let connectedBefore = false;
  let controller: AbortController | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let idle: ReturnType<typeof setTimeout> | null = null;

  const stopIdleTimer = () => {
    if (idle) clearTimeout(idle);
    idle = null;
  };

  const connect = async () => {
    const mine = new AbortController();
    controller = mine;
    const restartIdleTimer = () => {
      stopIdleTimer();
      idle = setTimeout(() => mine.abort(), IDLE_TIMEOUT_MS);
    };
    try {
      restartIdleTimer();
      const response = await fetch(url, {
        headers: { Accept: "text/event-stream" },
        signal: mine.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (connectedBefore) handlers.onReconnect();
      connectedBefore = true;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = createSseParser(handlers.onEvent);
      for (;;) {
        restartIdleTimer();
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
    } catch {
      // The desktop went away or the stream broke; the sync interval still
      // runs, and this tries again shortly.
    }
    stopIdleTimer();
    if (!closed) retry = setTimeout(connect, RECONNECT_DELAY_MS);
  };

  void connect();
  return () => {
    closed = true;
    if (retry) clearTimeout(retry);
    stopIdleTimer();
    controller?.abort();
  };
}
