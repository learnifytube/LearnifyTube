/*
  Universal logger powered by electron-log for both main and renderer.

  - In main process, uses 'electron-log/main' and initializes IPC bridge.
  - In renderer, prefers 'electron-log/renderer' (when available) or
    falls back to the global __electronLog exposed by main.initialize().

  Provides a stable API matching the prior ServerLogger usage:
    - debug/info/warn/error/fatal(...args)
    - clearLogFile(): Promise<void>  (no-op in renderer)
    - getFileContent(): Promise<string> (empty string in renderer)
*/

import * as fs from "fs";
import * as path from "path";

// Helper to normalize unknown errors to Error objects
function normalizeError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === "string") {
    return new Error(value);
  }
  if (typeof value === "object" && value !== null && "message" in value) {
    return new Error(String(value.message));
  }
  return new Error(String(value));
}

// Helper to normalize log arguments - converts unknown errors to Error objects
function normalizeLogArgs(args: unknown[]): unknown[] {
  return args.map((arg) => {
    // If it looks like an error (has stack, message, or is Error instance), normalize it
    if (
      arg instanceof Error ||
      (typeof arg === "object" &&
        arg !== null &&
        ("stack" in arg || "message" in arg || "name" in arg))
    ) {
      return normalizeError(arg);
    }
    return arg;
  });
}

type LogFunctions = {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

interface UniversalLogger extends LogFunctions {
  fatal: (...args: unknown[]) => void;
  clearLogFile: () => Promise<void>;
  getFileContent: () => Promise<string>;
  getFilePath: () => Promise<string | null>;
}

// Check if we're in main process
const isMain =
  typeof process !== "undefined" &&
  "type" in process &&
  typeof process.type === "string" &&
  process.type === "browser";

// Lazily load electron-log for the current context to avoid bundling the wrong entry
const getMainLogger = async (): Promise<LogFunctions> => {
  try {
    const mod = await import("electron-log/main");
    const log = mod.default ?? mod;

    // Ensure renderer bridge is initialized from main
    if (typeof log.initialize === "function") {
      log.initialize();
    }

    // An isolated desktop (LEARNIFYTUBE_USER_DATA_DIR) keeps its log out of the installed app's.
    const userDataDir = process.env.LEARNIFYTUBE_USER_DATA_DIR;
    if (userDataDir && log.transports?.file) {
      log.transports.file.resolvePathFn = () => `${userDataDir}/logs/main.log`;
    }

    // Ensure console transport is enabled so logs appear in terminal
    // This is especially important for showing renderer logs received via IPC
    if (log.transports?.console) {
      const isProd = process.env.NODE_ENV === "production";
      log.transports.console.level = isProd ? "info" : "debug";
    }

    return log;
  } catch {
    // Fallback to console if something went wrong
    return console;
  }
};

const getRendererLogger = async (): Promise<LogFunctions> => {
  // Prefer a direct renderer import to be able to configure transports (IPC in prod)
  try {
    const mod = await import("electron-log/renderer");
    const rlog = mod.default ?? mod;

    const isProd = process.env.NODE_ENV === "production";

    // In development, enable console transport so logs appear in DevTools
    if (!isProd && rlog.transports?.console) {
      rlog.transports.console.level = "debug";
    }

    // Enable IPC transport in both dev and prod so logs reach the main process
    // In main process, console transport will show them in terminal
    if (rlog.transports?.ipc) {
      rlog.transports.ipc.level = isProd ? "info" : "debug";
    }

    return rlog;
  } catch {
    // Fallback: rely on global injected by log.initialize() from main
    if ("__electronLog" in globalThis) {
      const electronLog: unknown = (globalThis as Record<string, unknown>).__electronLog;
      // Check if it has the required log methods
      if (
        typeof electronLog === "object" &&
        electronLog !== null &&
        "debug" in electronLog &&
        "info" in electronLog &&
        "warn" in electronLog &&
        "error" in electronLog
      ) {
        return electronLog as LogFunctions;
      }
    }

    // Final fallback to console to avoid crashes
    return console;
  }
};

// Initialize the logger asynchronously (skip in test environment to avoid Jest warnings)
const isTest =
  (typeof process !== "undefined" && process.env?.NODE_ENV === "test") ||
  (typeof process !== "undefined" && process.env?.JEST_WORKER_ID !== undefined);

const internalPromise = !isTest
  ? isMain
    ? getMainLogger()
    : getRendererLogger()
  : Promise.resolve(console);
let internal: LogFunctions = console;

// Initialize immediately (but don't block) - skip in test environment
if (!isTest) {
  void internalPromise.then((log) => {
    internal = log;
  });
}

// Type guard to check if an object implements LogFunctions
function isLogFunctions(obj: unknown): obj is LogFunctions {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }

  // Check properties using 'in' operator and property access with proper narrowing
  if (!("debug" in obj) || !("info" in obj) || !("warn" in obj) || !("error" in obj)) {
    return false;
  }

  // Now we know the properties exist, check their types
  // Use Record<string, unknown> to safely access properties
  const record: Record<string, unknown> = obj;
  const debug = record.debug;
  const info = record.info;
  const warn = record.warn;
  const error = record.error;

  return (
    typeof debug === "function" &&
    typeof info === "function" &&
    typeof warn === "function" &&
    typeof error === "function"
  );
}

// Helper to safely get electronLog from globalThis
function getElectronLogFromGlobal(): LogFunctions | null {
  if (!("__electronLog" in globalThis)) {
    return null;
  }

  // Access the property safely
  const record: Record<string, unknown> = globalThis;
  const electronLog = record.__electronLog;
  return isLogFunctions(electronLog) ? electronLog : null;
}

// Helper to get the current logger, trying electron-log first if available
const getCurrentLogger = (): LogFunctions => {
  // If electron-log is already initialized, use it
  if (internal !== console) {
    return internal;
  }

  // In renderer, try to use the global electronLog if available (injected by main.initialize())
  if (!isMain) {
    const electronLog = getElectronLogFromGlobal();
    if (electronLog) {
      return electronLog;
    }
  }

  // Fallback to console (or internal if it's already been set)
  return internal;
};

const resolveLogFilePath = async (): Promise<string | null> => {
  try {
    const mod = await import("electron-log/main");
    const log = mod.default ?? mod;
    const file = log.transports?.file?.getFile?.();
    if (file?.path) {
      return file.path;
    }
  } catch {
    // ignore and fall through to fallback path
  }

  try {
    const { app } = await import("electron");
    const userData = app.getPath("userData");
    return path.join(userData, "logs", "main.log");
  } catch {
    // ignore
  }

  return null;
};

// Adapter that preserves previous API surface
export const logger: UniversalLogger = {
  debug: (...args: unknown[]) => {
    try {
      const log = getCurrentLogger();
      log.debug?.(...args);
    } catch {
      // Silently ignore write errors
    }
  },
  info: (...args: unknown[]) => {
    try {
      const log = getCurrentLogger();
      log.info?.(...args);
    } catch {
      // Silently ignore write errors
    }
  },
  warn: (...args: unknown[]) => {
    try {
      const log = getCurrentLogger();
      log.warn?.(...normalizeLogArgs(args));
    } catch {
      // Silently ignore write errors
    }
  },
  error: (...args: unknown[]) => {
    try {
      const log = getCurrentLogger();
      log.error?.(...normalizeLogArgs(args));
    } catch {
      // Silently ignore write errors
    }
  },
  fatal: (...args: unknown[]) => {
    try {
      const log = getCurrentLogger();
      log.error?.("FATAL:", ...normalizeLogArgs(args));
    } catch {
      // Silently ignore write errors
    }
  },
  clearLogFile: async () => {
    if (!isMain) return; // no-op in renderer
    try {
      const filePath = await resolveLogFilePath();
      if (filePath) {
        await fs.promises.writeFile(filePath, "", { encoding: "utf-8" });
      }
    } catch {
      // ignore
    }
  },
  getFileContent: async () => {
    if (!isMain) return ""; // not available in renderer
    try {
      const filePath = await resolveLogFilePath();
      if (filePath && fs.existsSync(filePath)) {
        return await fs.promises.readFile(filePath, "utf8");
      }
    } catch {
      // ignore
    }
    return "";
  },
  getFilePath: async () => {
    if (!isMain) return null;
    try {
      return await resolveLogFilePath();
    } catch {
      return null;
    }
  },
};
