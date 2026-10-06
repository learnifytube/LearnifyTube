import { ExecutionEnvironment } from "expo-constants";
import { describeInstalledApp } from "./installed-app";

// What a release APK from CI (`expo prebuild` + Gradle) reports: a bare app
// whose version lives only in the embedded app config.
const releaseBuild = {
  os: "android",
  isDev: false,
  executionEnvironment: ExecutionEnvironment.Bare,
  appConfig: { version: "1.0.36", android: { versionCode: 36 } },
};

describe("describeInstalledApp", () => {
  it("lets a release APK update itself, reading its version from the app config", () => {
    expect(describeInstalledApp(releaseBuild)).toEqual({
      canSelfUpdate: true,
      versionName: "1.0.36",
      versionCode: 36,
    });
  });

  it("keeps development builds and Expo Go from updating themselves", () => {
    expect(
      describeInstalledApp({ ...releaseBuild, isDev: true }),
    ).toMatchObject({ canSelfUpdate: false });
    expect(
      describeInstalledApp({
        ...releaseBuild,
        executionEnvironment: ExecutionEnvironment.StoreClient,
      }),
    ).toMatchObject({ canSelfUpdate: false });
  });

  it("refuses a build without a versionCode, since it cannot compare releases", () => {
    expect(
      describeInstalledApp({ ...releaseBuild, appConfig: { version: "1.0.36" } }),
    ).toMatchObject({ canSelfUpdate: false, versionName: "1.0.36" });
  });
});
