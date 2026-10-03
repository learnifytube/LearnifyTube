import fs from "fs";
import { app } from "electron";
import path from "path";

interface DatabasePathConfig {
  customDatabasePath?: string | null;
}

const DATABASE_PATH_CONFIG_FILENAME = "database-path.json";

const resolveDevDatabasePath = (): string => path.resolve(process.cwd(), "local.db");

const getAppUserDataPath = (): string => {
  try {
    return app?.getPath("userData") ?? process.cwd();
  } catch {
    return process.cwd();
  }
};

export const getDatabasePathConfigPath = (): string =>
  path.join(getAppUserDataPath(), DATABASE_PATH_CONFIG_FILENAME);

const readDatabasePathConfig = (): DatabasePathConfig => {
  const configPath = getDatabasePathConfigPath();

  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed: unknown = JSON.parse(raw);

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "customDatabasePath" in parsed &&
      typeof parsed.customDatabasePath === "string" &&
      parsed.customDatabasePath.trim()
    ) {
      return {
        customDatabasePath: path.resolve(parsed.customDatabasePath),
      };
    }
  } catch {
    // Fall back to the default database path if the config file is unreadable.
  }

  return {};
};

const writeDatabasePathConfig = (config: DatabasePathConfig): void => {
  const configPath = getDatabasePathConfigPath();
  const directory = path.dirname(configPath);

  fs.mkdirSync(directory, { recursive: true });

  if (!config.customDatabasePath) {
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
    return;
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
};

export const getDefaultDatabaseFilePath = (): string => {
  const isPackaged = Boolean(app?.isPackaged);
  const forceDevDb = process.env.LEARNIFYTUBE_FORCE_DEV_DB === "true";
  const shouldUseDevDb = forceDevDb || !isPackaged;

  if (process.env.LEARNIFYTUBE_USER_DATA_DIR) {
    return path.join(getAppUserDataPath(), "local.db");
  }

  if (shouldUseDevDb) {
    return resolveDevDatabasePath();
  }

  return path.join(getAppUserDataPath(), "local.db");
};

export const getConfiguredDatabaseFilePath = (): string | null => {
  if (process.env.LEARNIFYTUBE_FORCE_DEV_DB === "true") {
    return null;
  }

  return readDatabasePathConfig().customDatabasePath ?? null;
};

export const setConfiguredDatabaseFilePath = (filePath: string): string => {
  const resolvedPath = path.resolve(filePath);
  writeDatabasePathConfig({ customDatabasePath: resolvedPath });
  return resolvedPath;
};

export const clearConfiguredDatabaseFilePath = (): void => {
  writeDatabasePathConfig({});
};

export const getActiveDatabaseFilePath = (): string => {
  return getConfiguredDatabaseFilePath() ?? getDefaultDatabaseFilePath();
};

export const isUsingDefaultDatabasePath = (): boolean => getConfiguredDatabaseFilePath() === null;

export const getDatabasePath = (): string => `file:${getActiveDatabaseFilePath()}`;
