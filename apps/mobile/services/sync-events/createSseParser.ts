/**
 * Reads a text/event-stream as it arrives and calls `onEvent` with each
 * event's name ("message" when it has none). The data isn't needed: every sync
 * event only says "sync again".
 */
export function createSseParser(onEvent: (event: string) => void) {
  let buffer = "";
  let eventName = "";
  let hasData = false;

  const readLine = (line: string) => {
    if (line === "") {
      if (hasData || eventName) onEvent(eventName || "message");
      eventName = "";
      hasData = false;
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") eventName = value;
    else if (field === "data") hasData = true;
  };

  return {
    push: (chunk: string) => {
      buffer += chunk;
      // A trailing "\r" may be the first half of a "\r\n" still on its way.
      const held = buffer.endsWith("\r") ? "\r" : "";
      const lines = buffer
        .slice(0, buffer.length - held.length)
        .split(/\r\n|\r|\n/);
      buffer = (lines.pop() ?? "") + held;
      for (const line of lines) readLine(line);
    },
  };
}
