import type { DiscoveredPeer } from "../../types";
import {
  createDesktopConnection,
  type DesktopAnswer,
  type DesktopConnectionPlatform,
} from "./createDesktopConnection";

const SAVED = "http://192.168.1.20:53318";

type Timer = { at: number; fn: () => void; id: number };

function createHarness({
  savedUrl = null as string | null,
  pairingCode = "CODE" as string | null,
  fallbackUrls = [] as string[],
} = {}) {
  let now = 0;
  let nextTimerId = 1;
  const timers = new Map<number, Timer>();
  const desktops = new Map<string, DesktopAnswer | Promise<DesktopAnswer>>();
  const requests: string[] = [];
  const peerListeners = new Set<{
    onPeerFound: (peer: DiscoveredPeer) => void;
    onPeerLost: (name: string) => void;
  }>();
  const foregroundListeners = new Set<() => void>();
  const saved = { url: savedUrl, name: null as string | null, pairingCode };
  let foreground = true;
  let rescans = 0;

  const platform: DesktopConnectionPlatform = {
    checkDesktop: async (url) => {
      requests.push(url);
      return desktops.get(url) ?? { kind: "unreachable" };
    },
    discovery: {
      subscribe: (listener) => {
        peerListeners.add(listener);
        return () => peerListeners.delete(listener);
      },
      rescan: () => {
        rescans += 1;
      },
    },
    isForeground: () => foreground,
    onForegroundChange: (listener) => {
      foregroundListeners.add(listener);
      return () => foregroundListeners.delete(listener);
    },
    loadSaved: async () => ({ url: saved.url, pairingCode: saved.pairingCode }),
    saveDesktop: (url, name) => {
      saved.url = url;
      saved.name = name;
    },
    forgetDesktop: () => {
      saved.url = null;
      saved.name = null;
    },
    savePairingCode: (code) => {
      saved.pairingCode = code;
    },
    fallbackUrls,
    clock: {
      setTimeout: (fn, ms) => {
        const id = nextTimerId++;
        timers.set(id, { at: now + ms, fn, id });
        return id;
      },
      clearTimeout: (id) => {
        timers.delete(id as number);
      },
    },
  };

  const connection = createDesktopConnection(platform);

  /** Moves the clock forward, running every timer that falls due on the way. */
  const advance = async (ms: number) => {
    const until = now + ms;
    for (;;) {
      await flush();
      const due = [...timers.values()]
        .filter((timer) => timer.at <= until)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      timers.delete(due.id);
      now = due.at;
      due.fn();
    }
    now = until;
    await flush();
  };

  return {
    connection,
    saved,
    requests,
    rescans: () => rescans,
    status: () => connection.getState().status,
    desktopAt: (url: string, answer: DesktopAnswer) =>
      desktops.set(url, answer),
    desktopGone: (url: string) => desktops.delete(url),
    /** The desktop at url answers its next check only when the returned function is called. */
    desktopSlowAt: (url: string) => {
      const usual = desktops.get(url);
      let answer: (value: DesktopAnswer) => void = () => {};
      desktops.set(url, new Promise((resolve) => (answer = resolve)));
      return async (value: DesktopAnswer) => {
        if (usual) desktops.set(url, usual);
        else desktops.delete(url);
        answer(value);
        await flush();
      };
    },
    peerFound: async (
      peer: Partial<DiscoveredPeer> & { host: string; port: number },
    ) => {
      for (const listener of peerListeners) {
        listener.onPeerFound({ name: "Desk", videoCount: 0, ...peer });
      }
      await flush();
    },
    setForeground: async (next: boolean) => {
      foreground = next;
      for (const listener of foregroundListeners) listener();
      await flush();
    },
    advance,
    start: async () => {
      const stop = connection.start();
      await flush();
      return stop;
    },
  };
}

async function flush() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

const ok = (name = "Desk"): DesktopAnswer => ({ kind: "ok", name });

describe("Desktop connection", () => {
  it("opens in Offline mode with the desktop off, then connects when it appears", async () => {
    const h = createHarness({ savedUrl: SAVED });
    await h.start();
    expect(h.status()).toBe("offline");

    h.desktopAt(SAVED, ok("Study PC"));
    await h.advance(3_000);

    expect(h.connection.getState()).toMatchObject({
      status: "connected",
      url: SAVED,
      desktopName: "Study PC",
    });
  });

  it("is connecting until its first check answers", async () => {
    const h = createHarness({ savedUrl: SAVED });
    h.desktopAt(SAVED, ok());
    h.connection.start();
    expect(h.status()).toBe("connecting");
    await flush();
    expect(h.status()).toBe("connected");
  });

  it("falls back to a discovered desktop when the saved address fails", async () => {
    const h = createHarness({ savedUrl: SAVED });
    h.desktopAt("http://192.168.1.30:53318", ok());
    await h.start();
    await h.peerFound({ host: "192.168.1.30", port: 53318 });

    expect(h.connection.getState()).toMatchObject({
      status: "connected",
      url: "http://192.168.1.30:53318",
    });
    expect(h.saved.url).toBe("http://192.168.1.30:53318");
  });

  it("finds the desktop again after its port changes, without pairing again", async () => {
    const h = createHarness({ savedUrl: SAVED });
    h.desktopAt(SAVED, ok());
    await h.start();
    expect(h.status()).toBe("connected");

    h.desktopGone(SAVED);
    h.desktopAt("http://192.168.1.20:53400", ok());
    await h.peerFound({ host: "192.168.1.20", port: 53400 });
    await h.advance(60_000);

    expect(h.connection.getState()).toMatchObject({
      status: "connected",
      url: "http://192.168.1.20:53400",
    });
    expect(h.saved.pairingCode).toBe("CODE");
  });

  it("tries the saved desktop on the legacy port and the emulator host", async () => {
    const h = createHarness({
      savedUrl: SAVED,
      fallbackUrls: ["http://10.0.2.2:53318"],
    });
    await h.start();
    expect(h.requests).toEqual([
      SAVED,
      "http://10.0.2.2:53318",
      "http://192.168.1.20:8384",
    ]);

    h.desktopAt("http://10.0.2.2:53318", ok());
    await h.advance(3_000);
    expect(h.connection.getState().url).toBe("http://10.0.2.2:53318");
  });

  it("stops retrying on a rejected pairing code until a new one is entered", async () => {
    const h = createHarness({ savedUrl: SAVED });
    h.desktopAt(SAVED, { kind: "pairingRequired" });
    await h.start();
    expect(h.status()).toBe("pairingRequired");

    const checks = h.requests.length;
    await h.advance(10 * 60_000);
    await h.peerFound({ host: "192.168.1.20", port: 53318 });
    h.connection.retryNow();
    await flush();
    expect(h.requests.length).toBe(checks);

    h.desktopAt(SAVED, ok());
    const result = await h.connection.pair("NEW");
    expect(h.saved.pairingCode).toBe("NEW");
    expect(result.status).toBe("connected");
  });

  it("moves a connected TV to pairing required when the desktop's code is reset", async () => {
    const h = createHarness({ savedUrl: SAVED });
    h.desktopAt(SAVED, ok());
    await h.start();

    h.desktopAt(SAVED, { kind: "pairingRequired" });
    await h.advance(60_000);
    expect(h.status()).toBe("pairingRequired");
    expect(h.connection.getState().url).toBeNull();
  });

  it("backs off from 3 s up to 60 s and never gives up", async () => {
    const h = createHarness({ savedUrl: SAVED });
    await h.start();
    const checkTimes: number[] = [];
    let elapsed = 0;
    for (let second = 0; second < 30 * 60; second++) {
      const before = h.requests.length;
      await h.advance(1_000);
      elapsed += 1_000;
      if (h.requests.length > before) checkTimes.push(elapsed);
    }

    const gaps = checkTimes.map((time, i) => time - (checkTimes[i - 1] ?? 0));
    expect(gaps.slice(0, 6)).toEqual([
      3_000, 6_000, 12_000, 24_000, 48_000, 60_000,
    ]);
    expect(new Set(gaps.slice(5))).toEqual(new Set([60_000]));
    expect(checkTimes.length).toBeGreaterThan(30);
  });

  it("tries a newly discovered desktop straight away", async () => {
    const h = createHarness();
    await h.start();
    await h.advance(5 * 60_000);
    expect(h.status()).toBe("offline");

    h.desktopAt("http://192.168.1.40:53318", ok());
    await h.peerFound({ host: "192.168.1.40", port: 53318 });

    expect(h.status()).toBe("connected");
  });

  it("tries a desktop discovered during another check as soon as that check ends", async () => {
    const h = createHarness({ savedUrl: SAVED });
    const answerSaved = h.desktopSlowAt(SAVED);
    h.connection.start();
    await flush();

    h.desktopAt("http://192.168.1.40:53318", ok());
    await h.peerFound({ host: "192.168.1.40", port: 53318 });
    await answerSaved({ kind: "unreachable" });

    expect(h.status()).toBe("connected");
  });

  it("switches to Offline mode when a health check fails while connected", async () => {
    const h = createHarness({ savedUrl: SAVED });
    h.desktopAt(SAVED, ok());
    await h.start();

    h.desktopGone(SAVED);
    await h.advance(15_000);

    expect(h.connection.getState()).toMatchObject({
      status: "offline",
      url: null,
    });
  });

  it("stays connected when a busy desktop misses one health check", async () => {
    const h = createHarness({ savedUrl: SAVED });
    h.desktopAt(SAVED, ok());
    await h.start();
    const statuses: string[] = [];
    h.connection.subscribe(() => statuses.push(h.status()));

    const answer = h.desktopSlowAt(SAVED);
    await h.advance(15_000);
    await answer({ kind: "unreachable" });
    await h.advance(1);

    expect(h.status()).toBe("connected");
    expect(statuses).not.toContain("offline");
  });

  it("stays connected between health checks whatever other requests do", async () => {
    const h = createHarness({ savedUrl: SAVED });
    h.desktopAt(SAVED, ok());
    await h.start();
    await h.advance(5 * 60_000);
    expect(h.status()).toBe("connected");
  });

  it("stops retrying while the app is in the background", async () => {
    const h = createHarness({ savedUrl: SAVED });
    await h.start();
    await h.setForeground(false);

    const checks = h.requests.length;
    await h.advance(10 * 60_000);
    expect(h.requests.length).toBe(checks);

    h.desktopAt(SAVED, ok());
    await h.setForeground(true);
    expect(h.status()).toBe("connected");
  });

  it("stops health checks in the background and checks again on return", async () => {
    const h = createHarness({ savedUrl: SAVED });
    h.desktopAt(SAVED, ok());
    await h.start();
    await h.setForeground(false);

    const checks = h.requests.length;
    await h.advance(10 * 60_000);
    expect(h.requests.length).toBe(checks);

    h.desktopGone(SAVED);
    await h.setForeground(true);
    expect(h.status()).toBe("offline");
  });

  it("shows an incompatible desktop as its own state", async () => {
    const h = createHarness({ savedUrl: SAVED });
    h.desktopAt(SAVED, {
      kind: "incompatible",
      issue: "desktop_update_required",
    });
    await h.start();

    expect(h.connection.getState()).toMatchObject({
      status: "incompatible",
      incompatibility: "desktop_update_required",
      url: null,
    });

    h.desktopAt(SAVED, ok());
    await h.advance(3_000);
    expect(h.status()).toBe("connected");
  });

  it("retries now and looks for the desktop again when asked", async () => {
    const h = createHarness({ savedUrl: SAVED });
    await h.start();
    await h.advance(5 * 60_000);

    h.desktopAt(SAVED, ok());
    h.connection.retryNow();
    expect(h.status()).toBe("connecting");
    await flush();

    expect(h.status()).toBe("connected");
    expect(h.rescans()).toBe(1);
  });

  it("connects to an address typed in by hand", async () => {
    const h = createHarness();
    h.desktopAt("http://192.168.1.50:53318", ok("Laptop"));
    await h.start();

    const result = await h.connection.connectManually("192.168.1.50");

    expect(result).toMatchObject({
      status: "connected",
      desktopName: "Laptop",
    });
    expect(h.saved.url).toBe("http://192.168.1.50:53318");
  });

  it("pairs with a desktop at an address typed in by hand", async () => {
    const h = createHarness({ pairingCode: null });
    h.desktopAt("http://192.168.1.50:9000", ok());
    await h.start();

    const result = await h.connection.pair("ABC", "192.168.1.50:9000");

    expect(result.status).toBe("connected");
    expect(h.saved).toMatchObject({
      pairingCode: "ABC",
      url: "http://192.168.1.50:9000",
    });
  });

  it("forgets the desktop and stops looking on disconnect", async () => {
    const h = createHarness({ savedUrl: SAVED });
    h.desktopAt(SAVED, ok());
    await h.start();

    h.connection.disconnect();
    expect(h.connection.getState()).toMatchObject({
      status: "offline",
      url: null,
    });
    expect(h.saved.url).toBeNull();

    const checks = h.requests.length;
    await h.advance(10 * 60_000);
    expect(h.requests.length).toBe(checks);
  });

  it("lists the desktops it has discovered", async () => {
    const h = createHarness();
    await h.start();
    await h.peerFound({ name: "Study PC", host: "192.168.1.60", port: 53318 });

    expect(h.connection.getState().peers).toEqual([
      expect.objectContaining({ name: "Study PC", host: "192.168.1.60" }),
    ]);
  });
});
