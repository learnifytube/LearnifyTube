import { RESUME_SYNC_PROTOCOL_VERSION } from "../../../shared/mobile-sync-contract";
import { supportsProtocol } from "./supportsProtocol";

export type ResumeDesktopPlatform = {
  getServerUrl: () => string | null;
  /** The connected desktop's sync protocol version, null until learnt. */
  knownDesktopVersion: (serverUrl: string) => number | null;
};

/**
 * Sends something already kept on this Device (a Track position, a Current
 * Video, a Series' last Episode) to the connected desktop at once, when it is
 * known to speak resume (v5). In Offline mode, or to a desktop older or not yet
 * asked, nothing is sent: the next Device report carries what was kept. A
 * failed send is only logged, for the same reason.
 */
export function createSendToResumeDesktop(platform: ResumeDesktopPlatform) {
  return (post: (serverUrl: string) => Promise<void>, what: string) => {
    const serverUrl = platform.getServerUrl();
    if (!serverUrl) return;
    const version = platform.knownDesktopVersion(serverUrl);
    if (!supportsProtocol(version, RESUME_SYNC_PROTOCOL_VERSION)) return;
    post(serverUrl).catch((error) => {
      console.warn(`Sending ${what} to the desktop failed`, error);
    });
  };
}
