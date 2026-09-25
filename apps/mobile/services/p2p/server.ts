import TcpSocket from "react-native-tcp-socket";
import { File } from "expo-file-system";
import * as FileSystemLegacy from "expo-file-system/legacy";
import { getDeviceName } from "./discovery";
import { offlineCopy } from "../offline-copy";
import type { Video, PeerVideo } from "../../types";

const DEFAULT_PORT = 53319;

const log = (message: string, data?: unknown) => {
  const timestamp = new Date().toISOString().split("T")[1].slice(0, 12);
  if (data) {
    console.log(`[${timestamp}] [P2P Server] ${message}`, data);
  } else {
    console.log(`[${timestamp}] [P2P Server] ${message}`);
  }
};

let server: ReturnType<typeof TcpSocket.createServer> | null = null;
let sharedVideos: Video[] = [];

/** Read an Offline copy from any Storage location (`file://` or `content://`). */
async function readOfflineCopyBytes(uri: string): Promise<Uint8Array> {
  // Picked-folder copies are content://; the SDK 54 File API is file://-oriented.
  if (uri.startsWith("content://")) {
    const base64 = await FileSystemLegacy.readAsStringAsync(uri, {
      encoding: FileSystemLegacy.EncodingType.Base64,
    });
    return Buffer.from(base64, "base64");
  }
  return new File(uri).bytes();
}

function parseHttpRequest(data: string): { method: string; path: string } | null {
  const lines = data.split("\r\n");
  if (lines.length === 0) return null;

  const requestLine = lines[0];
  const parts = requestLine.split(" ");
  if (parts.length < 2) return null;

  return {
    method: parts[0],
    path: parts[1].split("?")[0],
  };
}

function createHttpResponse(
  statusCode: number,
  contentType: string,
  body: string | Uint8Array
): Buffer {
  const statusText =
    statusCode === 200
      ? "OK"
      : statusCode === 404
      ? "Not Found"
      : "Internal Server Error";

  const isBuffer = body instanceof Uint8Array;
  const contentLength = isBuffer ? body.length : Buffer.byteLength(body, "utf8");

  const headers = [
    `HTTP/1.1 ${statusCode} ${statusText}`,
    `Content-Type: ${contentType}`,
    `Content-Length: ${contentLength}`,
    "Connection: close",
    "",
    "",
  ].join("\r\n");

  const headerBuffer = Buffer.from(headers, "utf8");

  if (isBuffer) {
    return Buffer.concat([headerBuffer, body]);
  }

  return Buffer.concat([headerBuffer, Buffer.from(body, "utf8")]);
}

async function handleRequest(path: string, method: string): Promise<{ statusCode: number; contentType: string; body: string | Uint8Array }> {
  log(`← ${method} ${path}`);

  // GET /info
  if (method === "GET" && path === "/info") {
    log("Handling /info request");
    const response = {
      name: getDeviceName(),
      videoCount: sharedVideos.length,
    };
    return {
      statusCode: 200,
      contentType: "application/json",
      body: JSON.stringify(response),
    };
  }

  // GET /videos
  if (method === "GET" && path === "/videos") {
    const videos: PeerVideo[] = sharedVideos.map((v) => ({
      id: v.id,
      title: v.title,
      channelTitle: v.channelTitle,
      duration: v.duration,
      hasTranscript: !!v.transcript,
    }));
    return {
      statusCode: 200,
      contentType: "application/json",
      body: JSON.stringify({ videos }),
    };
  }

  // GET /video/:id/meta
  const metaMatch = path.match(/^\/video\/([^/]+)\/meta$/);
  if (method === "GET" && metaMatch) {
    const videoId = metaMatch[1];
    const video = sharedVideos.find((v) => v.id === videoId);

    if (!video) {
      return {
        statusCode: 404,
        contentType: "text/plain",
        body: "Video not found",
      };
    }

    const meta = {
      id: video.id,
      title: video.title,
      channelTitle: video.channelTitle,
      duration: video.duration,
      transcript: video.transcript,
    };
    return {
      statusCode: 200,
      contentType: "application/json",
      body: JSON.stringify(meta),
    };
  }

  // GET /video/:id/file
  const fileMatch = path.match(/^\/video\/([^/]+)\/file$/);
  if (method === "GET" && fileMatch) {
    const videoId = fileMatch[1];
    const uri = offlineCopy.getUri(videoId);

    if (!uri) {
      return {
        statusCode: 404,
        contentType: "text/plain",
        body: "Offline copy not found",
      };
    }

    try {
      const bytes = await readOfflineCopyBytes(uri);
      return {
        statusCode: 200,
        contentType: "video/mp4",
        body: bytes,
      };
    } catch (error) {
      log(`Failed to read Offline copy for ${videoId}:`, error);
      return {
        statusCode: 404,
        contentType: "text/plain",
        body: "Offline copy not found",
      };
    }
  }

  return {
    statusCode: 404,
    contentType: "text/plain",
    body: "Not found",
  };
}

export function startServer(
  videos: Video[],
  port = DEFAULT_PORT
): Promise<number> {
  log(`Starting server on port ${port} with ${videos.length} videos`);

  return new Promise((resolve, reject) => {
    if (server) {
      log("Server already running, rejecting");
      reject(new Error("Server already running"));
      return;
    }

    sharedVideos = videos;
    log(`Shared videos set: ${sharedVideos.map(v => v.id).join(", ")}`);

    server = TcpSocket.createServer((socket) => {
      let requestData = "";

      socket.on("data", async (data) => {
        requestData += data.toString();

        // Check if we have a complete HTTP request (ends with \r\n\r\n)
        if (requestData.includes("\r\n\r\n")) {
          const parsed = parseHttpRequest(requestData);

          if (parsed) {
            const { statusCode, contentType, body } = await handleRequest(
              parsed.path,
              parsed.method
            );
            const response = createHttpResponse(statusCode, contentType, body);
            socket.write(response);
          }

          socket.destroy();
        }
      });

      socket.on("error", (error) => {
        console.error("Socket error:", error);
        socket.destroy();
      });
    });

    server.on("error", (error) => {
      console.error("Server error:", error);
      reject(error);
    });

    server.listen({ port, host: "0.0.0.0" }, () => {
      log(`✓ Server listening on 0.0.0.0:${port}`);
      resolve(port);
    });
  });
}

export async function stopServer() {
  return new Promise<void>((resolve) => {
    if (server) {
      server.close(() => {
        server = null;
        sharedVideos = [];
        resolve();
      });
    } else {
      resolve();
    }
  });
}

export function updateSharedVideos(videos: Video[]) {
  sharedVideos = videos;
}

export function isServerRunning(): boolean {
  return server !== null;
}

export { DEFAULT_PORT };
