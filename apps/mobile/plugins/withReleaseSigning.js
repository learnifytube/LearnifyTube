const { withAppBuildGradle } = require("@expo/config-plugins");

// Signs release builds with the keystore named by the LEARNIFY_RELEASE_*
// Gradle properties (CI passes them as ORG_GRADLE_PROJECT_* env vars).
// Without them, release builds keep the template's debug key so local
// `assembleRelease` still works; CI refuses to publish a debug-signed APK.
// See docs/adr/0001-release-apk-signed-with-own-key.md.
const MARKER = "LEARNIFY_RELEASE_STORE_FILE";

const RELEASE_SIGNING_CONFIG = `signingConfigs {
        release {
            if (project.hasProperty('${MARKER}')) {
                storeFile file(${MARKER})
                storePassword LEARNIFY_RELEASE_STORE_PASSWORD
                keyAlias LEARNIFY_RELEASE_KEY_ALIAS
                keyPassword LEARNIFY_RELEASE_KEY_PASSWORD
            }
        }`;

const RELEASE_BUILD_TYPE_SIGNING = `$1signingConfig project.hasProperty('${MARKER}') ? signingConfigs.release : signingConfigs.debug`;

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    const contents = gradleConfig.modResults.contents;
    if (contents.includes(MARKER)) {
      return gradleConfig;
    }

    const withSigningConfig = contents.replace(
      /signingConfigs\s*\{/,
      RELEASE_SIGNING_CONFIG,
    );
    const withBuildType = withSigningConfig.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
      RELEASE_BUILD_TYPE_SIGNING,
    );
    if (withSigningConfig === contents || withBuildType === withSigningConfig) {
      throw new Error(
        "withReleaseSigning: app/build.gradle no longer matches the expected signingConfigs/buildTypes layout.",
      );
    }

    gradleConfig.modResults.contents = withBuildType;
    return gradleConfig;
  });
}

module.exports = withReleaseSigning;
