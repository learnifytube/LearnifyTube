import type { IncomingMessage } from "http";

// Issue #29: every byte of a POST body arrives but the request never ends, so the
// handler waits forever. A body still arriving is a slow network, not the bug.
export const STUCK_BODY_AFTER_MS = 2000;

type ParserLike = {
  incoming?: unknown;
  constructor?: { kOnMessageComplete?: number };
  [key: number]: unknown;
};

export type StuckBody = {
  expectedBytes: number;
  receivedBytes: number;
  waitedMs: number;
  request: {
    complete: boolean;
    readableEnded: boolean;
    readableFlowing: boolean | null;
    readableLength: number;
  };
  socket: {
    remotePort?: number;
    bytesRead?: number;
    destroyed?: boolean;
    readableFlowing?: boolean | null;
    hasParser: boolean;
    parserOwnsRequest?: boolean;
    parserHasOnMessageComplete?: boolean;
  } | null;
};

const describeStuckBody = (
  req: IncomingMessage,
  expectedBytes: number,
  receivedBytes: number,
  waitedMs: number
): StuckBody => {
  const socket = req.socket as
    | (IncomingMessage["socket"] & { parser?: ParserLike | null })
    | undefined;
  const parser = socket?.parser ?? null;
  const onMessageCompleteSlot = parser?.constructor?.kOnMessageComplete;
  return {
    expectedBytes,
    receivedBytes,
    waitedMs,
    request: {
      complete: req.complete,
      readableEnded: req.readableEnded,
      readableFlowing: req.readableFlowing,
      readableLength: req.readableLength,
    },
    socket: socket
      ? {
          remotePort: socket.remotePort,
          bytesRead: socket.bytesRead,
          destroyed: socket.destroyed,
          readableFlowing: socket.readableFlowing,
          hasParser: parser !== null,
          parserOwnsRequest: parser ? parser.incoming === req : undefined,
          parserHasOnMessageComplete:
            parser && onMessageCompleteSlot !== undefined
              ? typeof parser[onMessageCompleteSlot] === "function"
              : undefined,
        }
      : null,
  };
};

/** Reads a request body, reporting once if it is all in but the request never ends. */
export const readRequestBody = async (
  req: IncomingMessage,
  onStuck: (stuck: StuckBody) => void,
  stuckAfterMs = STUCK_BODY_AFTER_MS
): Promise<string> => {
  const expectedBytes = Number(req.headers["content-length"]);
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // A body without Content-Length (chunked) is never watched.
  const watchIfComplete = (): void => {
    if (timer || Number.isNaN(expectedBytes) || receivedBytes < expectedBytes) return;
    timer = setTimeout(
      (): void => onStuck(describeStuckBody(req, expectedBytes, receivedBytes, stuckAfterMs)),
      stuckAfterMs
    );
    timer.unref?.();
  };

  try {
    watchIfComplete();
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);
      receivedBytes += buffer.length;
      watchIfComplete();
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    clearTimeout(timer);
  }
};
