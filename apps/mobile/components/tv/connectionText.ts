import type { DesktopConnectionState } from "../../services/desktop-connection";

const statusLabels: Record<DesktopConnectionState["status"], string> = {
  connected: "Connected",
  connecting: "Connecting…",
  offline: "Offline mode",
  pairingRequired: "Pairing required",
  incompatible: "Update needed",
};

/** The connection state in a few words, the same on every TV screen. */
export function describeConnectionStatus(connection: DesktopConnectionState) {
  return statusLabels[connection.status];
}

/** Why the TV isn't connected, in the viewer's words. */
export function describeConnectionProblem(connection: DesktopConnectionState) {
  if (connection.status === "pairingRequired") {
    return "The desktop needs its pairing code. Enter the code shown in desktop Settings → Sync.";
  }
  if (connection.status === "incompatible") {
    return connection.incompatibility === "mobile_update_required"
      ? "The desktop needs a newer version of this app."
      : "Update LearnifyTube on the desktop, then try again.";
  }
  if (connection.status === "connecting") return "Looking for your desktop…";
  return "Couldn't find the desktop. Make sure LearnifyTube is open on it with sync switched on. The TV keeps looking in the background.";
}
