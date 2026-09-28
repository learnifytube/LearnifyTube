import Zeroconf, { type ZeroconfService } from "react-native-zeroconf";
import Constants from "expo-constants";
import { Platform } from "react-native";
import type { DiscoveredPeer } from "../../types";
import { logger } from "../logger";

const SERVICE_TYPE = "learnify";
const ANDROID_ZEROCONF_IMPL = "DNSSD";
const zeroconf = new Zeroconf();

type ZeroconfMethodArgs = {
  scan: [type: string, protocol: string, domain: string, implType?: string];
  stop: [implType?: string];
  publishService: [
    type: string,
    protocol: string,
    domain: string,
    name: string,
    port: number,
    txt?: Record<string, string>,
    implType?: string,
  ];
  unpublishService: [name: string, implType?: string];
};

let isInitialized = false;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(typeof value === "string" ? value : String(value));

const invokeZeroconf = <K extends keyof ZeroconfMethodArgs>(
  methodName: K,
  ...args: ZeroconfMethodArgs[K]
): void => {
  const method = Reflect.get(zeroconf, methodName);
  if (typeof method !== "function") {
    throw new Error(`Zeroconf method '${String(methodName)}' is not available`);
  }

  Reflect.apply(method, zeroconf, [...args]);
};

const log = (message: string, data?: unknown) => {
  const prefix = `[mDNS] ${message}`;
  if (data === undefined) {
    logger.info(prefix);
    return;
  }

  if (data instanceof Error) {
    logger.error(prefix, data);
    return;
  }

  if (isRecord(data)) {
    logger.info(prefix, data);
    return;
  }

  logger.info(prefix, { value: String(data) });
};

function getZeroconfImplType(): string | undefined {
  return Platform.OS === "android" ? ANDROID_ZEROCONF_IMPL : undefined;
}

function ensureInitialized() {
  if (!isInitialized) {
    const implType = getZeroconfImplType();
    log("Initializing Zeroconf");
    if (implType) {
      invokeZeroconf("scan", SERVICE_TYPE, "tcp", "local.", implType);
      invokeZeroconf("stop", implType);
    } else {
      invokeZeroconf("scan", SERVICE_TYPE, "tcp", "local.");
      invokeZeroconf("stop");
    }
    isInitialized = true;
    log("Zeroconf initialized", { implType: implType ?? "default" });
  }
}

function normalizeHostCandidate(host: string): string {
  return host.trim().replace(/%.+$/, "");
}

function isIPv4(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

function shouldIgnoreHost(host: string): boolean {
  const lowered = host.toLowerCase();
  if (!lowered) return true;
  if (lowered === "localhost" || lowered === "::1") return true;
  if (lowered.startsWith("127.")) return true;
  // Link-local IPv6 is usually not routable without scope id on Android fetch URLs.
  if (lowered.startsWith("fe80:")) return true;
  return false;
}

function getTxtStringValue(txt: unknown, key: string): string | undefined {
  if (!txt || typeof txt !== "object") {
    return undefined;
  }
  const value = Reflect.get(txt, key);
  return typeof value === "string" ? value : undefined;
}

export function getDeviceName(): string {
  const name = Constants.deviceName || "LearnifyTube Device";
  log("Device name:", name);
  return name;
}

export function publishService(
  port: number,
  videoCount: number,
  onError?: (error: Error) => void
) {
  ensureInitialized();
  const implType = getZeroconfImplType();

  const name = getDeviceName();
  log(`Publishing service: ${name} on port ${port} with ${videoCount} videos`, {
    implType: implType ?? "default",
  });

  try {
    if (implType) {
      invokeZeroconf(
        "publishService",
        SERVICE_TYPE,
        "tcp",
        "local.",
        name,
        port,
        {
          videoCount: String(videoCount),
          platform: "mobile",
        },
        implType
      );
    } else {
      invokeZeroconf("publishService", SERVICE_TYPE, "tcp", "local.", name, port, {
        videoCount: String(videoCount),
        platform: "mobile",
      });
    }
    log("Service published successfully");
  } catch (error) {
    log("Failed to publish service", error);
    onError?.(toError(error));
  }
}

// Publish presence without running a server (just for discovery by desktop)
export function publishPresence(onError?: (error: Error) => void) {
  ensureInitialized();
  const implType = getZeroconfImplType();

  const name = getDeviceName();
  log(`Publishing presence: ${name}`, { implType: implType ?? "default" });

  try {
    // Use port 0 to indicate we're not running a server, just advertising presence
    if (implType) {
      invokeZeroconf(
        "publishService",
        SERVICE_TYPE,
        "tcp",
        "local.",
        name,
        53319,
        {
          videoCount: "0",
          platform: "mobile",
        },
        implType
      );
    } else {
      invokeZeroconf("publishService", SERVICE_TYPE, "tcp", "local.", name, 53319, {
        videoCount: "0",
        platform: "mobile",
      });
    }
    log("Presence published successfully");
  } catch (error) {
    log("Failed to publish presence", error);
    onError?.(toError(error));
  }
}

export function unpublishService() {
  const implType = getZeroconfImplType();
  log("Unpublishing service");
  try {
    if (implType) {
      invokeZeroconf("unpublishService", getDeviceName(), implType);
    } else {
      invokeZeroconf("unpublishService", getDeviceName());
    }
    log("Service unpublished");
  } catch (error) {
    log("Error unpublishing service (ignored)", error);
  }
}

type PeerCallbacks = {
  onPeerFound: (peer: DiscoveredPeer) => void;
  onPeerLost: (name: string) => void;
  onError?: (error: Error) => void;
};

// One scan serves every screen and module listening for peers; it stops when the last one leaves.
const subscribers = new Set<PeerCallbacks>();
const knownPeers = new Map<string, DiscoveredPeer>();

const onResolved = (service: ZeroconfService) => {
  const platform =
    getTxtStringValue(service?.txt, "platform")?.toLowerCase() ?? undefined;
  log("Service resolved:", {
    name: service.name,
    host: service.host,
    addresses: service.addresses,
    port: service.port,
    platform,
    txt: service.txt,
  });

  if (service.name === getDeviceName()) {
    log("Ignoring self");
    return;
  }

  // Only show desktop peers for sync connections.
  if (platform && platform !== "desktop") {
    log("Ignoring non-desktop service", { name: service.name, platform });
    return;
  }

  if (!service.port || service.port <= 0) {
    log("Ignoring service with invalid port", {
      name: service.name,
      port: service.port,
    });
    return;
  }

  const rawHosts: string[] = [];
  if (typeof service.host === "string") {
    rawHosts.push(service.host);
  }
  if (Array.isArray(service.addresses)) {
    for (const address of service.addresses) {
      if (typeof address === "string") {
        rawHosts.push(address);
      }
    }
  }

  const hosts = Array.from(
    new Set(
      rawHosts
        .map(normalizeHostCandidate)
        .filter((host) => !shouldIgnoreHost(host))
    )
  );

  if (hosts.length === 0) {
    log("Ignoring service with missing host", { name: service.name });
    return;
  }

  const primaryHost =
    hosts.find((host) => isIPv4(host)) ??
    hosts.find((host) => host.toLowerCase().endsWith(".local")) ??
    hosts[0];

  const peer: DiscoveredPeer = {
    name: service.name,
    host: primaryHost,
    hosts,
    port: service.port,
    videoCount: parseInt(service.txt?.videoCount || "0", 10),
  };
  log("Peer found:", peer);
  knownPeers.set(peer.name, peer);
  for (const subscriber of subscribers) subscriber.onPeerFound(peer);
};

const onRemove = (name: string) => {
  log("Service removed:", name);
  knownPeers.delete(name);
  for (const subscriber of subscribers) subscriber.onPeerLost(name);
};

const onScanError = (error: Error) => {
  log("Scan error:", error);
  for (const subscriber of subscribers) subscriber.onError?.(error);
};

function scan() {
  const implType = getZeroconfImplType();
  log(`Starting scan for _${SERVICE_TYPE}._tcp services`, {
    implType: implType ?? "default",
  });
  if (implType) {
    invokeZeroconf("scan", SERVICE_TYPE, "tcp", "local.", implType);
  } else {
    invokeZeroconf("scan", SERVICE_TYPE, "tcp", "local.");
  }
  log("Scan started");
}

function stopScan() {
  const implType = getZeroconfImplType();
  log("Stopping scan");
  if (implType) {
    invokeZeroconf("stop", implType);
  } else {
    invokeZeroconf("stop");
  }
  log("Scan stopped");
}

/** Reports desktops found through mDNS, starting with those already known, until unsubscribed. */
export function subscribeToPeers(callbacks: PeerCallbacks) {
  ensureInitialized();
  subscribers.add(callbacks);
  if (subscribers.size === 1) {
    zeroconf.on("resolved", onResolved);
    zeroconf.on("remove", onRemove);
    zeroconf.on("error", onScanError);
    scan();
  } else {
    for (const peer of knownPeers.values()) callbacks.onPeerFound(peer);
  }
  return () => {
    if (!subscribers.delete(callbacks) || subscribers.size > 0) return;
    stopScan();
    knownPeers.clear();
    zeroconf.removeListener("resolved", onResolved);
    zeroconf.removeListener("remove", onRemove);
    zeroconf.removeListener("error", onScanError);
  };
}

/** Starts the scan over, so desktops announce themselves again. */
export function rescanPeers() {
  if (subscribers.size === 0) return;
  stopScan();
  scan();
}

let unsubscribeScreen: (() => void) | null = null;

export function startScanning(callbacks: PeerCallbacks) {
  unsubscribeScreen?.();
  unsubscribeScreen = subscribeToPeers(callbacks);
}

export function stopScanning() {
  unsubscribeScreen?.();
  unsubscribeScreen = null;
}

export function cleanup() {
  unpublishService();
  stopScanning();
}
