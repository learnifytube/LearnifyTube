import { api } from "../api";
import { useConnectionStore } from "../../stores/connection";
import { createSendToResumeDesktop } from "./sendToResumeDesktop";

export { supportsProtocol } from "./supportsProtocol";

// The sync protocol version each desktop last said it speaks.
const known = new Map<string, number>();

/**
 * What this Device knows of the desktop's sync protocol version, so a feature
 * sends nothing new to an older desktop. The Device mirror learns it on every
 * sync (at once on connecting); a live send asks `known` and waits for the
 * next Device report while it is null.
 */
export const desktopProtocol = {
  /** Asks the desktop for its version and remembers it. */
  learn: async (serverUrl: string) => {
    const { syncProtocolVersion } = await api.getInfo(serverUrl);
    known.set(serverUrl, syncProtocolVersion);
    return syncProtocolVersion;
  },
  /** The version last learnt for this desktop; null before it was. */
  known: (serverUrl: string) => known.get(serverUrl) ?? null,
};

/** Sends a kept resume change to the connected desktop when it speaks resume. */
export const sendToResumeDesktop = createSendToResumeDesktop({
  getServerUrl: () => useConnectionStore.getState().serverUrl,
  knownDesktopVersion: desktopProtocol.known,
});
