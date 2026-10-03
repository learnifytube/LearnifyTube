import { useSyncExternalStore } from "react";
import type { DiscoveredPeer } from "../../types";

export type DesktopIncompatibility =
  "desktop_update_required" | "mobile_update_required";

/** What the desktop's info endpoint said about this Device. */
export type DesktopAnswer =
  | { kind: "ok"; name: string }
  | { kind: "pairingRequired" }
  | { kind: "incompatible"; issue: DesktopIncompatibility }
  | { kind: "unreachable" };

export type ConnectionStatus =
  "connecting" | "connected" | "offline" | "pairingRequired" | "incompatible";

export type DesktopConnectionState = {
  status: ConnectionStatus;
  /** The desktop answering health checks; null unless connected. */
  url: string | null;
  desktopName: string | null;
  incompatibility: DesktopIncompatibility | null;
  /** Desktops found through mDNS. */
  peers: DiscoveredPeer[];
};

type Timer = unknown;

export type DesktopConnectionPlatform = {
  /** Asks the desktop's info endpoint, including the sync-compatibility check. Never throws. */
  checkDesktop: (url: string) => Promise<DesktopAnswer>;
  discovery: {
    subscribe: (listener: {
      onPeerFound: (peer: DiscoveredPeer) => void;
      onPeerLost: (name: string) => void;
    }) => () => void;
    /** Starts the mDNS scan over, so desktops that moved announce themselves again. */
    rescan: () => void;
  };
  isForeground: () => boolean;
  onForegroundChange: (listener: () => void) => () => void;
  loadSaved: () => Promise<{ url: string | null; pairingCode: string | null }>;
  saveDesktop: (url: string, name: string) => void;
  forgetDesktop: () => void;
  savePairingCode: (code: string) => void;
  /** Other addresses to try when the saved one fails, such as the emulator's host. */
  fallbackUrls: string[];
  /** When set, the only address ever tried (verify builds keep off the user's own desktop). */
  pinnedUrl?: string;
  clock: {
    setTimeout: (fn: () => void, ms: number) => Timer;
    clearTimeout: (timer: Timer) => void;
  };
};

export const DEFAULT_SYNC_PORT = 53318;
export const LEGACY_SYNC_PORT = 8384;
const FIRST_RETRY_MS = 3_000;
const MAX_RETRY_MS = 60_000;
const HEALTH_CHECK_MS = 15_000;

const unique = (urls: string[]) => [...new Set(urls)];

function withPort(url: string, port: number) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}:${port}`;
  } catch {
    return null;
  }
}

function normalizeHost(host: string) {
  const trimmed = host.trim().replace(/%.+$/, "");
  return trimmed.includes(":") && !trimmed.startsWith("[")
    ? `[${trimmed}]`
    : trimmed;
}

function hostPriority(host: string) {
  const bare = host.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(bare)) return 0;
  if (bare.endsWith(".local")) return 1;
  if (bare.includes(":")) return 2;
  return 3;
}

/** Every URL a discovered desktop might answer on, most likely first. */
function peerUrls(peer: DiscoveredPeer) {
  const hosts = (peer.hosts?.length ? peer.hosts : [peer.host])
    .map(normalizeHost)
    .filter((host) => host.length > 0)
    .sort((a, b) => hostPriority(a) - hostPriority(b));
  const ports = unique(
    [peer.port, DEFAULT_SYNC_PORT, LEGACY_SYNC_PORT]
      .filter((port) => Number.isInteger(port) && port > 0)
      .map(String),
  );
  return unique(
    hosts.flatMap((host) => ports.map((port) => `http://${host}:${port}`)),
  );
}

/** The URLs to try for an address typed in by hand: a host, host:port or full URL. */
export function manualUrls(address: string) {
  const trimmed = address.trim();
  if (!trimmed) return [];
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    const protocol = parsed.protocol === "https:" ? "https:" : "http:";
    if (parsed.port) return [`${protocol}//${parsed.hostname}:${parsed.port}`];
    return [DEFAULT_SYNC_PORT, LEGACY_SYNC_PORT].map(
      (port) => `${protocol}//${parsed.hostname}:${port}`,
    );
  } catch {
    return [];
  }
}

type Outcome =
  | { kind: "ok"; url: string; name: string }
  | Exclude<DesktopAnswer, { kind: "ok" }>;

export function createDesktopConnection(platform: DesktopConnectionPlatform) {
  let state: DesktopConnectionState = {
    status: "connecting",
    url: null,
    desktopName: null,
    incompatibility: null,
    peers: [],
  };
  const listeners = new Set<() => void>();
  const peers = new Map<string, DiscoveredPeer>();
  let savedUrl: string | null = null;
  let loaded: Promise<void> | null = null;
  let running = false;
  // Set by disconnect(): nothing is tried until the viewer asks again.
  let stopped = false;
  let failures = 0;
  let timer: Timer | null = null;
  let busy: Promise<void> | null = null;
  // A desktop was discovered while a check was running: try again when it ends.
  let rerun = false;
  // Bumped by disconnect() and stop(), so answers to earlier checks are ignored.
  let epoch = 0;

  const setState = (next: Partial<DesktopConnectionState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const clearTimer = () => {
    if (timer !== null) platform.clock.clearTimeout(timer);
    timer = null;
  };

  const canRetry = () =>
    running &&
    !stopped &&
    state.status !== "pairingRequired" &&
    platform.isForeground();

  const candidates = () => {
    if (platform.pinnedUrl) return [platform.pinnedUrl];
    const alternatePorts = savedUrl
      ? [DEFAULT_SYNC_PORT, LEGACY_SYNC_PORT].map((port) =>
          withPort(savedUrl!, port),
        )
      : [];
    return unique(
      [
        savedUrl,
        ...[...peers.values()].flatMap(peerUrls),
        ...platform.fallbackUrls,
        ...alternatePorts,
      ].filter((url): url is string => !!url),
    );
  };

  const ask = async (url: string) => {
    try {
      return await platform.checkDesktop(url);
    } catch {
      return { kind: "unreachable" } as const;
    }
  };

  /** The first desktop that answers; a rejected code or an incompatible desktop ends the search. */
  const tryUrls = async (urls: string[]) => {
    for (const url of urls) {
      const answer = await ask(url);
      if (answer.kind === "ok")
        return { kind: "ok", url, name: answer.name } as const;
      if (answer.kind !== "unreachable") return answer;
    }
    return { kind: "unreachable" } as const;
  };

  const scheduleHealthCheck = () => {
    clearTimer();
    if (!running || !platform.isForeground()) return;
    timer = platform.clock.setTimeout(() => {
      timer = null;
      void exclusive(healthCheck);
    }, HEALTH_CHECK_MS);
  };

  const scheduleRetry = () => {
    clearTimer();
    if (!canRetry()) return;
    const delay = Math.min(FIRST_RETRY_MS * 2 ** failures, MAX_RETRY_MS);
    failures += 1;
    timer = platform.clock.setTimeout(() => {
      timer = null;
      void exclusive(() => attempt(false));
    }, delay);
  };

  const apply = (outcome: Outcome) => {
    if (outcome.kind === "ok") {
      failures = 0;
      savedUrl = outcome.url;
      platform.saveDesktop(outcome.url, outcome.name);
      setState({
        status: "connected",
        url: outcome.url,
        desktopName: outcome.name,
        incompatibility: null,
      });
      scheduleHealthCheck();
      return;
    }
    const lost = { url: null, incompatibility: null };
    if (outcome.kind === "pairingRequired") {
      clearTimer();
      setState({ ...lost, status: "pairingRequired" });
      return;
    }
    if (outcome.kind === "incompatible") {
      setState({
        ...lost,
        status: "incompatible",
        incompatibility: outcome.issue,
      });
    } else {
      setState({ ...lost, status: "offline" });
    }
    scheduleRetry();
  };

  /** Runs one check at a time; later ones wait their turn. */
  const exclusive = async (task: () => Promise<void>) => {
    while (busy) await busy;
    const current = task().finally(() => {
      busy = null;
      if (!rerun) return;
      rerun = false;
      attemptSoon();
    });
    busy = current;
    await current;
  };

  const attempt = async (visible: boolean, urls?: string[]) => {
    const started = epoch;
    clearTimer();
    await loaded;
    if (visible && state.status !== "connected") {
      setState({ status: "connecting" });
    }
    let outcome = await tryUrls(urls ?? candidates());
    if (urls && outcome.kind === "unreachable") {
      outcome = await tryUrls(candidates());
    }
    if (started === epoch) apply(outcome);
  };

  const healthCheck = async () => {
    const started = epoch;
    const url = state.url;
    if (state.status !== "connected" || !url) return;
    const answer = await ask(url);
    if (started !== epoch) return;
    if (answer.kind === "ok") {
      if (answer.name !== state.desktopName) {
        platform.saveDesktop(url, answer.name);
        setState({ desktopName: answer.name });
      }
      scheduleHealthCheck();
      return;
    }
    if (answer.kind !== "unreachable") {
      apply(answer);
      return;
    }
    // A busy desktop can miss one check, and a moved one answers elsewhere: look
    // everywhere once, still connected, before settling into Offline mode.
    failures = 0;
    await attempt(false);
  };

  /** A background attempt now, or right after the one running. */
  const attemptSoon = () => {
    if (!canRetry() || state.status === "connected") return;
    if (busy) {
      rerun = true;
      return;
    }
    void exclusive(() => attempt(false));
  };

  const onForegroundChange = () => {
    if (!platform.isForeground()) {
      clearTimer();
      return;
    }
    if (!running || stopped || state.status === "pairingRequired") return;
    if (state.status === "connected") void exclusive(healthCheck);
    else attemptSoon();
  };

  /** Connects and keeps the connection alive until the returned stop function is called. */
  const start = () => {
    running = true;
    loaded ??= platform.loadSaved().then((saved) => {
      savedUrl = saved.url;
    });
    const unsubscribePeers = platform.discovery.subscribe({
      onPeerFound: (peer) => {
        peers.set(peer.name, peer);
        setState({ peers: [...peers.values()] });
        attemptSoon();
      },
      onPeerLost: (name) => {
        peers.delete(name);
        setState({ peers: [...peers.values()] });
      },
    });
    const unsubscribeForeground =
      platform.onForegroundChange(onForegroundChange);
    void exclusive(() => attempt(true));
    return () => {
      running = false;
      epoch += 1;
      clearTimer();
      unsubscribePeers();
      unsubscribeForeground();
    };
  };

  /** Connects to address first when given, looking everywhere else if it doesn't answer. */
  const connectNow = async (address?: string) => {
    stopped = false;
    failures = 0;
    setState({ status: "connecting" });
    await exclusive(() =>
      attempt(true, address ? manualUrls(address) : undefined),
    );
    return state;
  };

  /** Saves a new pairing code (and, optionally, the desktop's address) and connects with it. */
  const pair = (code: string, address?: string) => {
    platform.savePairingCode(code.trim());
    return connectNow(address);
  };

  /** Connects to an address typed in by hand. */
  const connectManually = (address: string) => connectNow(address);

  /** Looks for the desktop again right away. Does nothing while a new pairing code is needed. */
  const retryNow = () => {
    if (state.status === "pairingRequired") return;
    stopped = false;
    failures = 0;
    platform.discovery.rescan();
    if (state.status === "connected") {
      void exclusive(healthCheck);
      return;
    }
    setState({ status: "connecting" });
    void exclusive(() => attempt(true));
  };

  /** Forgets the desktop and stops looking for it until the viewer connects again. */
  const disconnect = () => {
    epoch += 1;
    stopped = true;
    clearTimer();
    savedUrl = null;
    platform.forgetDesktop();
    setState({
      status: "offline",
      url: null,
      desktopName: null,
      incompatibility: null,
    });
  };

  const getState = () => state;

  return {
    start,
    pair,
    connectManually,
    retryNow,
    disconnect,
    getState,
    subscribe,
    useConnection: () => useSyncExternalStore(subscribe, getState),
  };
}

export type DesktopConnection = ReturnType<typeof createDesktopConnection>;
