import * as path from "path";
import * as fs from "fs";

import { eq } from "drizzle-orm";
import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  Notification,
  session,
  protocol,
} from "electron";
import { Readable } from "stream";
import { createIPCHandler } from "electron-trpc/main";
import registerListeners from "./helpers/ipc/listeners-register";
import { router } from "./api";
import { initializeDatabase } from "./api/db/init";
import { createContext } from "./api/trpc";
import { setWindowReferences } from "./api/routers/window";

import { logger } from "./helpers/logger";
import { initializeQueueManager } from "./services/download-queue/queue-manager";
import defaultDb from "./api/db";
import { userPreferences } from "./api/db/schema";

// Global error handlers to prevent crashes from logging errors
process.on("uncaughtException", (error) => {
  // Ignore EIO errors from console/stdout (happens when terminal is closed)
  if (error.message?.includes("EIO") || error.message?.includes("write E")) {
    return;
  }
  // Log other errors to file only (avoid console to prevent recursive errors)
  try {
    logger.error("[uncaughtException]", error);
  } catch {
    // Ignore if logging also fails
  }
});

process.on("unhandledRejection", (reason) => {
  try {
    logger.error("[unhandledRejection]", reason);
  } catch {
    // Ignore if logging fails
  }
});

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuiting: boolean = false;
let stopAccessingSecurityScopedResource: (() => void) | null = null;

const isVoidFunction = (value: unknown): value is () => void => typeof value === "function";

/**
 * Get the tray instance
 * @returns The tray instance or null if not created yet
 */
export function getTray(): Tray | null {
  return tray;
}

/**
 * Show and focus the main window
 */
export function showMainWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }

  // Show the window if it's hidden
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  // Restore the window if it's minimized
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  // Bring the window to front and focus it
  mainWindow.focus();

  // Platform-specific window activation
  if (process.platform === "darwin") {
    // On macOS, use setAlwaysOnTop briefly to ensure it comes to front
    mainWindow.setAlwaysOnTop(true);
    mainWindow.setAlwaysOnTop(false);
  } else if (process.platform === "win32") {
    // On Windows, use more aggressive focusing
    mainWindow.setAlwaysOnTop(true);
    mainWindow.setAlwaysOnTop(false);
    mainWindow.moveTop();
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "local-file",
    privileges: {
      standard: true,
      secure: true,
      corsEnabled: true,
      supportFetchAPI: true,
      bypassCSP: true,
      allowServiceWorkers: false,
    },
  },
]);

async function createTray(): Promise<void> {
  // Request notification permission on macOS
  if (process.platform === "darwin") {
    await app.whenReady();
    if (!Notification.isSupported()) {
      logger.debug("Notifications not supported");
    }
  }

  // Get the correct path to the resources directory
  let iconPath: string;
  const isDev = !app.isPackaged;

  if (isDev) {
    // In development mode, use the root project directory
    const rootDir = path.resolve(path.join(__dirname, "..", ".."));
    iconPath =
      process.platform === "win32"
        ? path.join(rootDir, "resources", "icon.ico")
        : path.join(rootDir, "resources", "icon_16x16.png");
  } else {
    // In production mode
    if (process.platform === "darwin") {
      // For macOS, use the Contents/Resources directory
      // The resources folder is packaged as extraResource, so files are in resources/ subdirectory
      iconPath = path.join(process.resourcesPath, "resources", "icon_16x16.png");
      logger.debug("Main: Using macOS production path:", iconPath);
    } else {
      // For Windows and other platforms
      iconPath = path.join(process.resourcesPath, "resources", "icon.ico");
    }
  }

  logger.debug("Main: Icon path", iconPath);

  // Check if file exists
  if (fs.existsSync(iconPath)) {
    logger.debug("Main: Icon file exists at path", iconPath);
  } else {
    logger.error("Main: Icon file does not exist at path", iconPath);
    logger.debug("Main: __dirname value:", __dirname);
    logger.debug("Main: Resolved absolute path:", path.resolve(iconPath));

    // Try alternative paths for macOS
    if (process.platform === "darwin" && !isDev) {
      const altPaths = [
        path.join(process.resourcesPath, "resources", "icon_16x16.png"),
        path.join(app.getAppPath(), "resources", "icon_16x16.png"),
        path.join(__dirname, "../../resources/icon_16x16.png"),
      ];

      for (const altPath of altPaths) {
        logger.debug("Main: Trying alternative path:", altPath);
        if (fs.existsSync(altPath)) {
          iconPath = altPath;
          logger.debug("Main: Found icon at alternative path:", iconPath);
          break;
        }
      }
    }

    // List directory contents to debug
    try {
      const resourcesDir = path.dirname(iconPath);
      logger.debug("Main: Checking resources directory:", resourcesDir);
      const files = fs.readdirSync(resourcesDir);
      logger.debug("Main: Resources directory contents:", files);
    } catch (err) {
      logger.error("Main: Error reading resources directory:", err);
    }
  }

  const icon = nativeImage.createFromPath(iconPath);
  logger.debug("Main: Created nativeImage, isEmpty:", icon.isEmpty());

  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show LearnifyTube",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip("LearnifyTube");

  tray.setTitle("");

  tray.on("click", () => {
    showMainWindow();
  });
}

function createWindow(): void {
  const preload = path.join(__dirname, "preload.js");
  const isDev = !app.isPackaged;

  const iconPath = path.join(__dirname, "../resources/icon.ico");
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 1000,
    icon: iconPath,
    movable: true,
    webPreferences: {
      webSecurity: !isDev, // Enable web security in production mode (like lossless-cut)
      devTools: isDev, // Only enable dev tools in development
      contextIsolation: true,
      nodeIntegration: true,
      nodeIntegrationInSubFrames: false,
      preload,
    },
    // Use native OS title bar
    frame: true,
  });

  createIPCHandler({
    router,
    windows: [mainWindow],
    createContext,
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    // Open DevTools automatically in development
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  } else {
    const mainPath = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
    logger.info("Main: Loading main window from:", mainPath);
    logger.info("Main: MAIN_WINDOW_VITE_NAME:", MAIN_WINDOW_VITE_NAME);
    mainWindow.loadFile(mainPath);
    // Only open DevTools in development mode
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  }

  // Set up window references for tRPC window router
  setWindowReferences(mainWindow, tray);

  // Register other IPC listeners (excluding window listeners)
  registerListeners(mainWindow, tray);

  // Disable background throttling to keep video playing when window is hidden
  mainWindow.webContents.setBackgroundThrottling(false);

  mainWindow.on("close", (event) => {
    if (!isQuiting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
// Only check this on Windows as Squirrel is Windows-specific
// This must be checked BEFORE requesting single instance lock
if (process.platform === "win32") {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const squirrelStartup: boolean = require("electron-squirrel-startup");
  logger.info("[app] Squirrel startup check:", squirrelStartup);
  if (squirrelStartup) {
    logger.info("[app] Squirrel installer event detected, quitting...");
    app.quit();
  }
} else {
  logger.info("[app] Skipping Squirrel check on non-Windows platform");
}

// Ensure single instance - prevent multiple app instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running, quit this one
  logger.info("[app] Another instance is running, quitting...");
  app.quit();
} else {
  logger.info("[app] Got single instance lock, continuing...");
  // This is the first instance, handle second instance events
  app.on("second-instance", () => {
    // Someone tried to run a second instance, focus our window instead
    logger.info("[app] Second instance detected, focusing window...");
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      mainWindow.focus();

      // On Windows, bring to front more aggressively
      if (process.platform === "win32") {
        mainWindow.setAlwaysOnTop(true);
        mainWindow.setAlwaysOnTop(false);
      }
    } else {
      // If no window exists, create one
      createWindow();
    }
  });
}

// Initialize app when ready
app.whenReady().then(async () => {
  logger.info("[app] App is ready, starting initialization...");

  // Set App User Model ID on Windows (like lossless-cut does)
  // This is required for proper Windows notifications and window management
  if (process.platform === "win32") {
    app.setAppUserModelId(app.getName());
  }

  try {
    logger.clearLogFile();
    logger.info("[app] Initializing database...");
    await initializeDatabase();
    logger.info("[app] Database initialized successfully");

    // Initialize download queue manager
    logger.info("[app] Initializing download queue manager");
    await initializeQueueManager(defaultDb, { autoStart: true });
    logger.info("[app] Download queue manager initialized");

    // Check if mobile sync should auto-start based on user preference
    try {
      const prefs = await defaultDb
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.id, "default"))
        .limit(1);

      if (prefs.length > 0 && prefs[0].customizationSettings) {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const settings = JSON.parse(prefs[0].customizationSettings) as {
          sync?: { enabled?: boolean; port?: number };
        };
        if (settings.sync?.enabled) {
          logger.info("[app] Mobile sync is enabled, starting server...");
          const { getMobileSyncServer } = await import("./main/mobileSyncServer");
          const syncServer = getMobileSyncServer();
          const port = settings.sync.port ?? 53318;
          await syncServer.start(port);
          logger.info("[app] Mobile sync server started");
        }
      }
    } catch (syncError) {
      logger.error("[app] Failed to start mobile sync server", syncError);
      // Don't fail app startup if sync server fails
    }
  } catch (error) {
    logger.error("[app.whenReady] Failed to initialize database:", error);
    // Don't quit on error, try to continue
  }

  // Restore security scoped bookmark if present (macOS only)
  if (process.platform === "darwin") {
    try {
      const prefs = await defaultDb
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.id, "default"))
        .limit(1);

      if (prefs.length > 0 && prefs[0].downloadPathBookmark) {
        logger.info("[app] Restoring security scoped bookmark...");
        const stopAccessing = app.startAccessingSecurityScopedResource(
          prefs[0].downloadPathBookmark
        );
        if (isVoidFunction(stopAccessing)) {
          stopAccessingSecurityScopedResource = () => {
            stopAccessing();
          };
          logger.info("[app] Security scoped bookmark restored");
        } else {
          logger.warn("[app] Unexpected security scoped bookmark handle type", {
            handleType: typeof stopAccessing,
          });
        }
      }
    } catch (err) {
      logger.error("[app] Failed to restore security scoped bookmark", err);
    }
  }

  // Register custom protocol that streams local files from main (supports Range)
  // IMPORTANT: Must register BEFORE creating windows to ensure protocol is available in production mode
  let localFileRequestCounter = 0;
  protocol.registerStreamProtocol("local-file", (request, callback) => {
    const requestId = ++localFileRequestCounter;
    try {
      const rawUrl = request.url;
      const rangeHeader = request.headers.Range || request.headers.range || null;
      logger.info("[protocol] local-file request received", {
        requestId,
        rawUrl,
        hasRangeHeader: Boolean(rangeHeader),
      });
      const decodedPath = decodeURIComponent(rawUrl.replace("local-file://", ""));
      const normalizedPath = decodedPath.startsWith("/") ? decodedPath : `/${decodedPath}`;
      if (normalizedPath !== decodedPath) {
        logger.debug("[protocol] Normalized local-file path", {
          requestId,
          decodedPath,
          normalizedPath,
        });
      }
      const filePath = path.resolve(normalizedPath);
      if (!fs.existsSync(filePath)) {
        logger.error("[protocol] Requested local file does not exist", {
          requestId,
          rawUrl,
          filePath,
        });
        callback({ statusCode: 404, data: Readable.from([]) });
        return;
      }

      try {
        fs.accessSync(filePath, fs.constants.R_OK);
      } catch (accessError: unknown) {
        const accessMessage =
          accessError instanceof Error ? accessError.message : String(accessError);
        logger.error("[protocol] local-file lacks read access", {
          requestId,
          filePath,
          accessMessage,
        });
        callback({ statusCode: 403, data: Readable.from([]) });
        return;
      }

      const stat = fs.statSync(filePath);
      const totalSize = stat.size;
      const range = rangeHeader;

      // Content-type based on extension with enhanced MP4 handling
      const ext = path.extname(filePath).toLowerCase();
      let contentType: string;
      if (ext === ".mp4") {
        contentType = "video/mp4";
        // Log MP4 file details for codec debugging
        logger.info("[protocol] Serving MP4 file", {
          requestId,
          filePath,
          fileSize: totalSize,
          note: "MP4 may use H.265/HEVC codec which Chromium doesn't support",
        });
      } else if (ext === ".webm") {
        contentType = "video/webm";
      } else if (ext === ".mkv") {
        contentType = "video/x-matroska";
      } else {
        contentType = "application/octet-stream";
      }

      // Enhanced headers for Chromium media playback
      const baseHeaders = {
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
      };

      if (range && typeof range === "string") {
        const match = range.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;
          const chunkSize = end - start + 1;

          logger.debug("[protocol] local-file partial stream", {
            requestId,
            filePath,
            start,
            end,
            chunkSize,
            totalSize,
          });

          const stream = fs.createReadStream(filePath, { start, end });

          stream.on("error", (streamError) => {
            logger.error("[protocol] local-file partial stream error", {
              requestId,
              filePath,
              message: streamError instanceof Error ? streamError.message : String(streamError),
            });
          });

          callback({
            statusCode: 206,
            headers: {
              ...baseHeaders,
              "Content-Range": `bytes ${start}-${end}/${totalSize}`,
              "Content-Length": String(chunkSize),
            },
            data: stream,
          });
          return;
        }
      }

      // full file
      logger.debug("[protocol] local-file full stream", { requestId, filePath, totalSize });
      const stream = fs.createReadStream(filePath);

      stream.on("error", (streamError) => {
        logger.error("[protocol] local-file full stream error", {
          requestId,
          filePath,
          message: streamError instanceof Error ? streamError.message : String(streamError),
        });
      });

      callback({
        statusCode: 200,
        headers: {
          ...baseHeaders,
          "Content-Length": String(totalSize),
        },
        data: stream,
      });
    } catch (error: unknown) {
      logger.error("[protocol] Failed to stream local-file URL", { requestId, error });
      callback({ statusCode: 500, data: Readable.from([]) });
    }
  });

  // Start media server for reliable video streaming
  logger.info("[app] Starting media server...");
  const { getMediaServer } = await import("./main/mediaServer");
  const mediaServer = getMediaServer();
  await mediaServer.start();
  logger.info("[app] Media server started successfully");

  logger.info("[app] Creating tray...");
  await createTray();
  logger.info("[app] Tray created successfully");

  logger.info("[app] Creating main window...");
  createWindow();
  logger.info("[app] Main window created successfully");

  // Modify CSP to allow scripts from PostHog and inline scripts
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; " +
            "script-src 'self' 'unsafe-inline' https://*.posthog.com; " +
            "connect-src 'self' http://127.0.0.1:* https://*.posthog.com; " +
            "img-src 'self' data: file: local-file: https://*.posthog.com https://i.ytimg.com https://*.ytimg.com https://yt3.ggpht.com https://yt3.googleusercontent.com;" +
            "media-src 'self' data: file: local-file: http://127.0.0.1:*; " +
            "style-src 'self' 'unsafe-inline'; " +
            "frame-src 'self';",
        ],
      },
    });
  });

  // Filter and block specific PostHog requests that are not needed
  session.defaultSession.webRequest.onBeforeRequest(
    {
      urls: [
        "https://*.posthog.com/static/surveys.js*",
        "https://*.posthog.com/static/toolbar.js*",
        "https://*.posthog.com/static/recorder.js*",
      ],
    },
    (details, callback) => {
      // Block these specific requests
      callback({ cancel: true });
    }
  );
});

// Handle app quit
app.on("before-quit", () => {
  isQuiting = true;
  if (stopAccessingSecurityScopedResource) {
    stopAccessingSecurityScopedResource();
    stopAccessingSecurityScopedResource = null;
  }
});

//osX only
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    showMainWindow();
  }
});

export {};

//osX only ends
// This allows TypeScript to pick up the magic constants that's auto-generated by Forge's Vite
// plugin that tells the Electron app where to look for the Vite-bundled app code (depending on
// whether you're running in development or production).
export declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
export declare const MAIN_WINDOW_VITE_NAME: string;
// Preload types
interface ThemeModeContext {
  toggle: () => Promise<boolean>;
  dark: () => Promise<void>;
  light: () => Promise<void>;
  system: () => Promise<boolean>;
  current: () => Promise<"dark" | "light" | "system">;
}

declare global {
  interface Window {
    themeMode: ThemeModeContext;
    electronNotification?: {
      send: (data: unknown) => Promise<void>;
      close: () => Promise<void>;
      action: () => Promise<void>;
      onNotification: (callback: (data: unknown) => void) => void;
    };
    ytdlp?: {
      isInstalled: () => Promise<boolean>;
      getVersion: () => Promise<string | null>;
      checkUpdates: () => Promise<{ hasUpdate: boolean; latestVersion: string | null }>;
      download: () => Promise<{ success: boolean }>;
      update: () => Promise<{ success: boolean }>;
      getPath: () => Promise<string>;
      onDownloadStarted: (callback: () => void) => void;
      onDownloadProgress: (
        callback: (progress: { downloaded: number; total: number; percentage: number }) => void
      ) => void;
      onDownloadCompleted: (callback: (version: string) => void) => void;
      onDownloadFailed: (callback: (error: string) => void) => void;
      onUpdateAvailable: (callback: (version: string) => void) => void;
    };
  }
}
