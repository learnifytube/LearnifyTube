import * as FileSystemLegacy from "expo-file-system/legacy";

/**
 * Writes the desktop's file at `url` to `destUri`; "missing" when the desktop
 * answered 202 (it lost the file and is fetching it again).
 */
export async function transferFile(
  url: string,
  destUri: string,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
): Promise<"done" | "missing"> {
  const transfer = FileSystemLegacy.createDownloadResumable(
    url,
    destUri,
    {},
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      if (totalBytesExpectedToWrite > 0) {
        onProgress(
          Math.round((totalBytesWritten / totalBytesExpectedToWrite) * 100),
        );
      }
    },
  );
  const abort = () => {
    transfer.pauseAsync().catch(() => {});
  };
  signal.addEventListener("abort", abort);
  try {
    const result = await transfer.downloadAsync();
    if (signal.aborted) throw new Error("Download cancelled");
    if (result?.status === 202) return "missing";
    if (!result || result.status !== 200) {
      throw new Error(`Download failed: ${result?.status ?? "unknown error"}`);
    }
    return "done";
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
