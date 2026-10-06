# Release APKs are signed with our own release key

Until `mobile-v1.0.37`, CI signed release APKs with the public React Native template debug key (`CN=Android Debug`, SHA-1 `5e8f1606…`), because `expo prebuild --clean` regenerates `android/` with no release signing config. Chrome on Android holds or flags APKs downloaded with that signature, so the website's download link stalled at 99%, and anyone could publish an "update" signed as us. We now sign with our own release keystore, kept as a CI secret. GitHub Releases on the website stays the distribution channel; Google Play is deferred.

## Consequences

- Android refuses in-place updates across a signing-key change. Every install of the debug-signed app must be uninstalled once (losing local data) and reinstalled, and the in-app APK updater cannot bridge the switch.
- Losing the release keystore strands every install the same way, so it must be backed up outside CI.
