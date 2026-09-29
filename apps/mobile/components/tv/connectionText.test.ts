import type { DesktopConnectionState } from "../../services/desktop-connection";
import { describeConnectionStatus } from "./connectionText";

const connection = (overrides: Partial<DesktopConnectionState>) =>
  ({
    status: "offline",
    url: null,
    desktopName: null,
    incompatibility: null,
    peers: [],
    ...overrides,
  }) satisfies DesktopConnectionState;

describe("describeConnectionStatus", () => {
  it("names each connection state", () => {
    expect(describeConnectionStatus(connection({ status: "connected" }))).toBe(
      "Connected",
    );
    expect(describeConnectionStatus(connection({ status: "offline" }))).toBe(
      "Offline mode",
    );
    expect(
      describeConnectionStatus(connection({ status: "pairingRequired" })),
    ).toBe("Pairing required");
    expect(describeConnectionStatus(connection({ status: "connecting" }))).toBe(
      "Connecting…",
    );
    expect(
      describeConnectionStatus(connection({ status: "incompatible" })),
    ).toBe("Update needed");
  });
});
