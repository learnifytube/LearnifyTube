// forge.config.ts - Configuration for Electron Forge build process

import type { ForgeConfig, ForgePackagerOptions } from "@electron-forge/shared-types";
import { readdirSync, rmdirSync, statSync, copyFileSync, mkdirSync, existsSync } from "node:fs";
import path, { join, normalize } from "node:path";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerDMG } from "@electron-forge/maker-dmg";
// Use flora-colossus for finding all dependencies of EXTERNAL_DEPENDENCIES
// flora-colossus is maintained by MarshallOfSound (a top electron-forge contributor)
// already included as a dependency of electron-packager/galactus (so we do NOT have to add it to package.json)
// grabs nested dependencies from tree
import { Walker, DepType, type Module } from "flora-colossus";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { PublisherGithub } from "@electron-forge/publisher-github";

// Track native module dependencies that need to be packaged
let nativeModuleDependenciesToPackage: string[] = [];
type MakerDMGArtifacts = Awaited<ReturnType<MakerDMG["make"]>>;

const singleMakerDMGArtifact = (artifactPath: string): MakerDMGArtifacts => [artifactPath];

class ResilientMakerDMG extends MakerDMG {
  async make(options: Parameters<MakerDMG["make"]>[0]): ReturnType<MakerDMG["make"]> {
    const { makeDir, appName, packageJSON, targetArch } = options;
    const configuredName = this.config.name || appName;
    const outPath = path.resolve(makeDir, `${configuredName}.dmg`);
    const forgeDefaultOutPath = path.resolve(
      makeDir,
      `${appName}-${packageJSON.version}-${targetArch}.dmg`
    );

    try {
      return await super.make(options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const detachRace =
        message.includes("hdiutil detach") && message.includes("No such file or directory");

      if (!detachRace || !existsSync(outPath)) {
        throw error;
      }

      console.warn(
        "⚠️  DMG cleanup reported a missing mount during detach, but the image was created successfully."
      );

      if (!this.config.name) {
        await this.ensureFile(forgeDefaultOutPath);
        if (outPath !== forgeDefaultOutPath) {
          await import("fs-extra").then(({ default: fsExtra }) =>
            fsExtra.rename(outPath, forgeDefaultOutPath)
          );
        }
        return singleMakerDMGArtifact(forgeDefaultOutPath);
      }

      return singleMakerDMGArtifact(outPath);
    }
  }
}

/**
 * External dependencies that require special handling during Electron packaging.
 *
 * These dependencies are explicitly included in the final bundle to ensure they
 * are properly packaged and available at runtime. This is necessary because:
 *
 * 1. **Native modules** (like @libsql/darwin-x64) need to be bundled with their
 *    platform-specific binaries
 * 2. **Runtime dependencies** (like drizzle-orm, zod) are used by the main process
 *    and need to be available when the app starts
 * 3. **Electron-specific modules** (like electron-squirrel-startup) handle
 *    Windows installer integration
 *
 * This configuration is based on the solution from:
 * https://github.com/electron/forge/issues/3738
 *
 * @see {@link https://github.com/electron/forge/issues/3738|Electron Forge Issue #3738}
 */
export const EXTERNAL_DEPENDENCIES = [
  // Windows installer integration - handles Squirrel installer events
  "electron-squirrel-startup",
  // Runtime validation library used throughout the application
  "zod",
  // SQLite client library for database operations
  "@libsql/client",
  // Platform-specific SQLite binaries for macOS ARM64
  "@libsql/darwin-x64",
  // Database ORM for type-safe database queries
  "drizzle-orm",
  // Date manipulation library for time tracking features
  "date-fns",
  // tRPC server for type-safe API communication
  "@trpc/server",
  // ZIP extraction library for auto-updates (replaced extract-zip with yauzl for better reliability)
  "yauzl",
  // FFmpeg binary provider (must be bundled so we can copy the binary at runtime)
  "ffmpeg-static",
  // mDNS service discovery for mobile sync
  "bonjour-service",
];

// Base packager configuration
const packagerConfig: ForgePackagerOptions = {
  // The name of the executable
  executableName: "LearnifyTube",
  // The name of the application
  name: "LearnifyTube",
  // Path to the application icon
  icon: process.platform === "win32" ? "./resources/icon.ico" : "./resources/icon",
  // The bundle ID for the application
  appBundleId: "com.learnifytube.app",
  // Define custom protocols for the application
  protocols: [
    {
      name: "LearnifyTube",
      schemes: ["learnifytube"],
    },
  ],
  // Include additional resources in the final build
  extraResource: ["./resources", "./drizzle", "./assets/bin"],
};

// Configure macOS-specific settings (both development and production)
if (process.platform === "darwin") {
  // Add Info.plist keys for Apple Events usage
  packagerConfig.extendInfo = {
    NSAppleEventsUsageDescription:
      "LearnifyTube needs access to browser applications to provide enhanced functionality for managing and downloading YouTube content.",
    // Additional Info.plist keys for better permission handling
    NSAppleScriptEnabled: true,
    OSAScriptingDefinition: "com.learnifytube.app.sdef",
  };

  // Configure codesigning and notarization for production builds
  if (process.env["NODE_ENV"] === "production") {
    packagerConfig.osxSign = {
      // Options for codesigning the application
      optionsForFile: (filePath: string) => ({
        identity: "Developer ID Application", // Use your Developer ID
        entitlements: path.join(__dirname, "entitlements.plist"),
        "entitlements-inherit": path.join(__dirname, "entitlements.plist"),
        hardenedRuntime: true,
        "gatekeeper-assess": false,
        // Ensure proper signing of all components
        type: "distribution",
      }),
    };

    // Only configure notarization if all required credentials are present
    const appleId = process.env.APPLE_ID;
    const appleIdPassword = process.env.APPLE_ID_PASSWORD;
    const teamId = process.env.APPLE_TEAM_ID;

    if (appleId && appleIdPassword && teamId) {
      packagerConfig.osxNotarize = {
        appleId: appleId,
        appleIdPassword: appleIdPassword,
        teamId: teamId,
      };
      console.log("✅ Notarization configured with Apple ID:", appleId);
    } else {
      console.log("⚠️  Skipping notarization - missing Apple Developer credentials");
      console.log("   APPLE_ID:", appleId ? "✓" : "✗");
      console.log("   APPLE_ID_PASSWORD:", appleIdPassword ? "✓" : "✗");
      console.log("   APPLE_TEAM_ID:", teamId ? "✓" : "✗");
    }
  } else {
    // Development mode - disable codesigning to avoid invalid signature issues
    // Ad-hoc signing is automatically applied by Electron which is sufficient for development
    console.log("ℹ️  Development build - skipping codesigning (ad-hoc signature will be used)");
    // packagerConfig.osxSign is intentionally NOT set for development builds
  }
}

// Main Electron Forge configuration
const config: ForgeConfig = {
  // Hooks for custom build steps
  hooks: {
    // Pre-package hook to gather native module dependencies
    prePackage: async () => {
      const projectRoot = normalize(__dirname);
      const getExternalNestedDependencies = async (
        nodeModuleNames: string[],
        includeNestedDeps = true
      ) => {
        const foundModules = new Set(nodeModuleNames);
        if (includeNestedDeps) {
          for (const external of nodeModuleNames) {
            const moduleRoot = join(projectRoot, "node_modules", external);
            const walker = new Walker(moduleRoot);
            Reflect.set(walker, "modules", []);
            const walkDependenciesForModule = Reflect.get(walker, "walkDependenciesForModule");
            if (typeof walkDependenciesForModule === "function") {
              await walkDependenciesForModule.call(walker, moduleRoot, DepType.PROD);
            }
            const modulesValue = Reflect.get(walker, "modules");
            const walkerModules: Module[] = Array.isArray(modulesValue) ? modulesValue : [];
            walkerModules
              .filter((dep) => (dep.nativeModuleType as number) === DepType.PROD)
              // for a package like '@realm/fetch', need to split the path and just take the first part
              .map((dep) => dep.name.split("/")[0])
              .forEach((name) => foundModules.add(name));
          }
        }
        return foundModules;
      };
      const nativeModuleDependencies = await getExternalNestedDependencies(EXTERNAL_DEPENDENCIES);
      nativeModuleDependenciesToPackage = Array.from(nativeModuleDependencies);

      // Copy FFmpeg binary from ffmpeg-static to assets/bin for bundling
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const ffmpegStatic: string | undefined = require("ffmpeg-static");
        if (ffmpegStatic && typeof ffmpegStatic === "string" && existsSync(ffmpegStatic)) {
          const assetsBinDir = join(projectRoot, "assets", "bin");
          mkdirSync(assetsBinDir, { recursive: true });
          const targetName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
          const targetPath = join(assetsBinDir, targetName);
          copyFileSync(ffmpegStatic, targetPath);
          console.log("✅ Copied FFmpeg binary to assets/bin for bundling");
        }
      } catch (error) {
        console.warn("⚠️  Could not copy FFmpeg binary (ffmpeg-static may not be installed):", error);
      }
    },
    // Post-package hook to remove empty directories
    packageAfterPrune: async (_forgeConfig, buildPath) => {
      function getItemsFromFolder(
        path: string,
        totalCollection: {
          path: string;
          type: "directory" | "file";
          empty: boolean;
        }[] = []
      ) {
        try {
          const normalizedPath = normalize(path);
          const childItems = readdirSync(normalizedPath);
          const getItemStats = statSync(normalizedPath);
          if (getItemStats.isDirectory()) {
            totalCollection.push({
              path: normalizedPath,
              type: "directory",
              empty: childItems.length === 0,
            });
          }
          childItems.forEach((childItem) => {
            const childItemNormalizedPath = join(normalizedPath, childItem);
            const childItemStats = statSync(childItemNormalizedPath);
            if (childItemStats.isDirectory()) {
              getItemsFromFolder(childItemNormalizedPath, totalCollection);
            } else {
              totalCollection.push({
                path: childItemNormalizedPath,
                type: "file",
                empty: false,
              });
            }
          });
        } catch {
          return;
        }
        return totalCollection;
      }

      const getItems = getItemsFromFolder(buildPath) ?? [];
      for (const item of getItems) {
        const DELETE_EMPTY_DIRECTORIES = true;
        if (item.empty === true) {
          if (DELETE_EMPTY_DIRECTORIES) {
            const pathToDelete = normalize(item.path);
            // one last check to make sure it is a directory and is empty
            const stats = statSync(pathToDelete);
            if (!stats.isDirectory()) {
              // SKIPPING DELETION: pathToDelete is not a directory
              return;
            }
            const childItems = readdirSync(pathToDelete);
            if (childItems.length !== 0) {
              // SKIPPING DELETION: pathToDelete is not empty
              return;
            }
            rmdirSync(pathToDelete);
          }
        }
      }
    },
  },
  // Packager configuration
  packagerConfig: {
    ...packagerConfig,
    // Enable pruning of unnecessary files
    prune: true,
    // Unpack *.node files from the asar archive
    asar: { unpack: "*.node" },
    // Add resources folder, migrations, and bundled binaries
    extraResource: ["./resources", "./drizzle", "./assets/bin"],
    // Ignore files that match the following conditions
    ignore: (file) => {
      const filePath = file.toLowerCase();
      const KEEP_FILE = {
        keep: false,
        log: true,
      };
      // NOTE: must return false for empty string or nothing will be packaged
      if (filePath === "") KEEP_FILE.keep = true;
      if (!KEEP_FILE.keep && filePath === "/package.json") KEEP_FILE.keep = true;
      if (!KEEP_FILE.keep && filePath === "/node_modules") KEEP_FILE.keep = true;
      if (!KEEP_FILE.keep && filePath === "/.vite") KEEP_FILE.keep = true;
      if (!KEEP_FILE.keep && filePath.startsWith("/.vite/")) KEEP_FILE.keep = true;
      if (!KEEP_FILE.keep && filePath.startsWith("/node_modules/")) {
        // check if matches any of the external dependencies
        for (const dep of nativeModuleDependenciesToPackage) {
          if (filePath === `/node_modules/${dep}/` || filePath === `/node_modules/${dep}`) {
            KEEP_FILE.keep = true;
            break;
          }
          if (filePath === `/node_modules/${dep}/package.json`) {
            KEEP_FILE.keep = true;
            break;
          }
          if (filePath.startsWith(`/node_modules/${dep}/`)) {
            KEEP_FILE.keep = true;
            KEEP_FILE.log = false;
            break;
          }
        }
      }
      if (KEEP_FILE.keep) {
        if (KEEP_FILE.log) console.log("Keeping:", file);
        return false;
      }
      return true;
    },

    // if applicable, your other config / options / app info

    // Overwrite existing build files
    overwrite: true,

    // osxSign: {
    //   // if applicable, your codesigning configuration here
    // },

    // osxNotarize: {
    //   // if applicable, your notarization configuration here
    // },
  },
  // Rebuild configuration
  rebuildConfig: {},
  // Makers for different platforms
  makers: [
    new MakerSquirrel({
      setupIcon: path.resolve(__dirname, "resources", "icon.ico"),
      iconUrl: "https://raw.githubusercontent.com/learnifytube/LearnifyTube/main/apps/desktop/resources/icon.ico",
      loadingGif: path.resolve(__dirname, "resources", "icon_64x64.png"),
      // Naming pattern: LearnifyTube-{version}.Setup.exe
      name: "LearnifyTube-${version}.Setup.exe",
    }),
    new ResilientMakerDMG({
      icon: path.resolve(__dirname, "resources", "icon.icns"),
      format: "ULFO", // Use a different format that works better with permissions
      overwrite: true,
      // Default naming pattern: LearnifyTube-{version}-{arch}.dmg
    }),
    new MakerRpm({
      options: {
        bin: "LearnifyTube",
      },
      // Default naming pattern: LearnifyTube-{version}-1.x86_64.rpm
    }),
    new MakerDeb({
      options: {
        bin: "LearnifyTube",
      },
      // Default naming pattern: LearnifyTube_{version}_amd64.deb
    }),
  ],
  // Publishers for different platforms

  publishers: [
    new PublisherGithub({
      repository: {
        owner: "learnifytube",
        name: "LearnifyTube",
      },
      prerelease: process.env.RELEASE_PRERELEASE === "true",
      draft: process.env.RELEASE_DRAFT === "true",
    }),
  ],
  // Plugins for custom build steps
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: "src/main.ts",
          config: "vite.main.config.ts",
        },
        {
          entry: "src/preload.ts",
          config: "vite.preload.config.ts",
        },
        {
          entry: "src/preload/notification.ts",
          config: "vite.notification-preload.config.ts",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
        {
          name: "notification_window",
          config: "vite.notification.config.ts",
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
