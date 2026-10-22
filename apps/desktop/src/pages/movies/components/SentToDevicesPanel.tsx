import React from "react";
import { Smartphone, Tv } from "lucide-react";
import { Button } from "@/components/ui/button";

export type HoldingDevice = {
  id: string;
  name: string;
  kind: "phone" | "tv";
  lastSeenAt: number;
};

/**
 * Send to Devices / Remove from Devices for what the desktop sends whole (a
 * Movie, or a Season), and the Devices that hold it.
 */
export function SentToDevicesPanel({
  noun,
  sentToDevices,
  devices,
  pending,
  onChange,
}: {
  /** "Movie" or "Season". */
  noun: string;
  sentToDevices: boolean;
  devices: HoldingDevice[];
  pending: boolean;
  onChange: (sent: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant={sentToDevices ? "outline" : "default"}
          onClick={() => onChange(!sentToDevices)}
          disabled={pending}
        >
          {sentToDevices ? "Remove from Devices" : "Send to Devices"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {sentToDevices
            ? `Sent: Devices download this ${noun} and keep it for Offline mode.`
            : "Not sent to Devices. Devices can still Stream it."}
        </span>
      </div>
      <p className="mt-3 text-xs font-semibold">On Devices</p>
      {devices.length === 0 ? (
        <p className="text-xs text-muted-foreground">No Device holds this {noun} yet.</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1">
          {devices.map((device) => (
            <li key={device.id} className="flex items-center gap-2 text-sm">
              {device.kind === "tv" ? (
                <Tv className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Smartphone className="h-4 w-4 text-muted-foreground" />
              )}
              <span>{device.name}</span>
              <span className="text-xs text-muted-foreground">
                last seen {new Date(device.lastSeenAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
