# 0003: Real-time SSE push for On-device set sync and unified "Sent to Devices" terminology

When a user adds or removes a Video from their On-device set on desktop, connected phones and TVs should receive and reflect that change immediately rather than waiting for background polling cycles. In addition, the desktop UI previously used "Add to Phone" / "Phone List", which was misleading because Android TV devices mirror the exact same On-device set.

## Context

- `docs/adr/0001-desktop-decides-the-on-device-set.md` established that the desktop decides what every Device holds, and all Devices share one unified On-device set.
- Previously, mobile devices only polled the desktop periodically (every 2 minutes or on foreground resume), resulting in high latency when sending a video from desktop to watch on TV or phone.
- The desktop referred to single videos sent to devices as the "Phone List", causing confusion for users sending videos to an Android TV.

## Decision

1. **SSE Push Channel (`/api/events`)**:
   - The desktop Mobile Sync Server exposes a lightweight Server-Sent Events stream (`GET /api/events`) authenticated via the existing pairing bearer token.
   - Whenever the On-device set changes (single video toggled or a list switched on/off), the desktop emits an event (`event: sync:on-device-set`).
   - Connected devices listening to the SSE stream trigger an immediate `deviceMirror.sync()`.
   - The existing interval-based mirror and 15s health check remain in place as a resilient fallback when devices are asleep, offline, or reconnecting.

2. **Auto-Keep on Send**:
   - Triggering "Send to Devices" on a Video that has not yet been kept/downloaded on the desktop will automatically initiate the desktop Keep (`startDownload`), ensuring the file is prepared on desktop and ready for the device to download.

3. **Terminology Alignment ("Sent to Devices")**:
   - Desktop UI and glossary adopt **Sent to Devices** (action: "Send to Devices" / "Remove from Devices", icon: `MonitorSmartphone`), matching mobile's "Sent to this phone" and "Sent to this TV".

## Consequences

- Sending a video from the desktop player or library cards immediately pushes the video to paired phones and TVs on the local network.
- The sync protocol contract (`apps/shared/mobile-sync-contract.ts`) documents the `/api/events` endpoint.
- Existing database tables (`phone_list_items`) are preserved as internal storage details, avoiding disruptive database migrations.
