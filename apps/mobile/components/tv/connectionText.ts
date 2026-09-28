import type { DesktopConnectionState } from "../../services/desktop-connection";

/** Why the TV isn't connected, in the viewer's words. */
export function describeConnectionProblem(connection: DesktopConnectionState) {
  if (connection.status === "pairingRequired") {
    return "The desktop didn't accept the pairing code. Enter the code shown in desktop Settings → Sync.";
  }
  if (connection.status === "incompatible") {
    return connection.incompatibility === "mobile_update_required"
      ? "The desktop needs a newer version of this app."
      : "Update LearnifyTube on the desktop, then try again.";
  }
  if (connection.status === "connecting") return "Looking for your desktop…";
  return "Couldn't find the desktop. Make sure LearnifyTube is open on it with sync switched on. The TV keeps looking in the background.";
}
