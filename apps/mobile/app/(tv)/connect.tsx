import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  TextInput,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useConnectionStore } from "../../stores/connection";
import { colors } from "../../theme";
import { api, PairingRequiredError } from "../../services/api";
import { ensureDiscoveryPermissions } from "../../services/discovery-permissions";
import { startScanning, stopScanning } from "../../services/p2p/discovery";
import {
  assertSyncCompatibility,
  SyncCompatibilityError,
} from "../../services/sync-compatibility";
import { TVFocusPressable } from "../../components/tv/TVFocusPressable";
import type { DiscoveredPeer } from "../../types";

const DEFAULT_SYNC_PORT = 53318;
const LEGACY_SYNC_PORT = 8384;
const AUTO_CONNECT_DELAY_SECONDS = 3;
const AUTO_CONNECT_DELAY_MS = AUTO_CONNECT_DELAY_SECONDS * 1000;
const CONNECTION_ATTEMPT_TIMEOUT_MS = 4000;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function buildManualConnectUrls(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  try {
    const parsed = new URL(withScheme);
    const protocol = parsed.protocol === "https:" ? "https:" : "http:";

    if (parsed.port) {
      return [`${protocol}//${parsed.hostname}:${parsed.port}`];
    }

    return Array.from(
      new Set([
        `${protocol}//${parsed.hostname}:${DEFAULT_SYNC_PORT}`,
        `${protocol}//${parsed.hostname}:${LEGACY_SYNC_PORT}`,
      ])
    );
  } catch {
    if (trimmed.includes(":")) return [`http://${trimmed}`];
    return [
      `http://${trimmed}:${DEFAULT_SYNC_PORT}`,
      `http://${trimmed}:${LEGACY_SYNC_PORT}`,
    ];
  }
}

function normalizeDiscoveredHost(host: string): string {
  const trimmed = host.trim().replace(/%.+$/, "");
  if (trimmed.includes(":") && !trimmed.startsWith("[")) {
    return `[${trimmed}]`;
  }
  return trimmed;
}

function hostPriority(host: string): number {
  const bare = host.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(bare)) return 0;
  if (bare.endsWith(".local")) return 1;
  if (bare.includes(":")) return 2;
  return 3;
}

function buildDiscoveredConnectUrls(device: DiscoveredPeer): string[] {
  const hosts = (
    device.hosts && device.hosts.length > 0 ? device.hosts : [device.host]
  )
    .map(normalizeDiscoveredHost)
    .filter((host) => host.length > 0)
    .sort((a, b) => hostPriority(a) - hostPriority(b));

  if (hosts.length === 0) return [];

  const ports = [device.port, DEFAULT_SYNC_PORT, LEGACY_SYNC_PORT].filter(
    (value, index, arr): value is number =>
      Number.isInteger(value) && value > 0 && arr.indexOf(value) === index
  );

  const urls: string[] = [];
  for (const host of hosts) {
    for (const port of ports) {
      urls.push(`http://${host}:${port}`);
    }
  }
  return Array.from(new Set(urls));
}

function getPeerKey(peer: DiscoveredPeer): string {
  return `${peer.name}|${peer.host}|${peer.port}`;
}

export default function TVConnectScreen() {
  const { setServerUrl, setServerName, pairingCode, setPairingCode } = useConnectionStore();

  const [input, setInput] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredPeer[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const [autoConnectCountdown, setAutoConnectCountdown] = useState<number | null>(null);
  const [autoConnectBlockedPeerKey, setAutoConnectBlockedPeerKey] = useState<string | null>(null);

  const autoConnectIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoConnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const candidates = useMemo(() => buildManualConnectUrls(input), [input]);
  const singleDiscoveredDevice = discoveredDevices.length === 1 ? discoveredDevices[0] : null;
  const singleDiscoveredPeerKey = useMemo(
    () => (singleDiscoveredDevice ? getPeerKey(singleDiscoveredDevice) : null),
    [singleDiscoveredDevice]
  );

  const clearAutoConnectTimers = useCallback(() => {
    if (autoConnectIntervalRef.current) {
      clearInterval(autoConnectIntervalRef.current);
      autoConnectIntervalRef.current = null;
    }
    if (autoConnectTimeoutRef.current) {
      clearTimeout(autoConnectTimeoutRef.current);
      autoConnectTimeoutRef.current = null;
    }
  }, []);

  const connectWithCandidates = useCallback(
    async (
      candidateUrls: string[],
      fallbackName: string,
      options?: {
        fromAuto?: boolean;
        silentSuccess?: boolean;
      }
    ) => {
      if (candidateUrls.length === 0) {
        if (!options?.fromAuto) {
          Alert.alert("Connection failed", "No valid connection endpoint found.");
        }
        return false;
      }

      setIsConnecting(true);
      let lastError: unknown = null;

      try {
        for (const baseUrl of candidateUrls) {
          try {
            const info = await api.getInfo(baseUrl, {
              timeoutMs: CONNECTION_ATTEMPT_TIMEOUT_MS,
            });
            assertSyncCompatibility(info);
            const serverName = info.name ?? fallbackName;
            setServerUrl(baseUrl);
            setServerName(serverName);

            if (!options?.silentSuccess) {
              Alert.alert("Connected", `Connected to ${serverName}`);
            }

            router.back();
            return true;
          } catch (error) {
            if (error instanceof SyncCompatibilityError) {
              if (error.issue === "desktop_update_required") {
                Alert.alert("Desktop Update Required", error.message);
              } else {
                Alert.alert("Mobile Update Required", error.message);
              }
              return false;
            }
            if (error instanceof PairingRequiredError) {
              if (options?.fromAuto) {
                setScanError(error.message);
              } else {
                Alert.alert("Pairing Code Needed", error.message);
              }
              return false;
            }
            lastError = error;
          }
        }

        const reason = getErrorMessage(lastError ?? new Error("All connection attempts failed"));

        if (options?.fromAuto) {
          setScanError(`Auto-connect failed: ${reason}`);
        } else {
          Alert.alert("Connection failed", reason);
        }

        return false;
      } finally {
        setIsConnecting(false);
      }
    },
    [setServerName, setServerUrl]
  );

  const connectToDiscoveredDevice = useCallback(
    async (
      device: DiscoveredPeer,
      options?: {
        fromAuto?: boolean;
        silentSuccess?: boolean;
      }
    ) => {
      const candidateUrls = buildDiscoveredConnectUrls(device);
      return connectWithCandidates(candidateUrls, device.name, options);
    },
    [connectWithCandidates]
  );

  const connectToManualInput = useCallback(async () => {
    if (candidates.length === 0) {
      Alert.alert("Enter an IP", "Input desktop IP or host first.");
      return;
    }

    await connectWithCandidates(candidates, "Desktop");
  }, [candidates, connectWithCandidates]);

  useEffect(() => {
    let cancelled = false;

    const beginScanning = async () => {
      setIsScanning(true);
      setScanError(null);

      try {
        const permissionStatus = await ensureDiscoveryPermissions();
        if (cancelled) return;

        if (!permissionStatus.granted) {
          setScanError("Nearby devices permission is required for auto-discovery.");
          setIsScanning(false);
          return;
        }

        startScanning({
          onPeerFound: (peer) => {
            if (cancelled) return;
            setDiscoveredDevices((prev) => {
              const existing = prev.find((item) => item.name === peer.name);
              if (existing) {
                return prev.map((item) => (item.name === peer.name ? peer : item));
              }
              return [...prev, peer];
            });
          },
          onPeerLost: (name) => {
            if (cancelled) return;
            setDiscoveredDevices((prev) => prev.filter((item) => item.name !== name));
          },
          onError: (error) => {
            if (cancelled) return;
            setScanError(`Discovery error: ${getErrorMessage(error)}`);
          },
        });
      } catch (error) {
        if (!cancelled) {
          setScanError(`Discovery failed: ${getErrorMessage(error)}`);
          setIsScanning(false);
        }
      }
    };

    void beginScanning();

    return () => {
      cancelled = true;
      clearAutoConnectTimers();
      stopScanning();
      setIsScanning(false);
    };
  }, [clearAutoConnectTimers]);

  useEffect(() => {
    if (!singleDiscoveredPeerKey) {
      setAutoConnectBlockedPeerKey(null);
      return;
    }

    if (
      autoConnectBlockedPeerKey &&
      autoConnectBlockedPeerKey !== singleDiscoveredPeerKey
    ) {
      setAutoConnectBlockedPeerKey(null);
    }
  }, [autoConnectBlockedPeerKey, singleDiscoveredPeerKey]);

  useEffect(() => {
    clearAutoConnectTimers();

    const isManualTyping = input.trim().length > 0;
    const canAutoConnect =
      !!singleDiscoveredDevice &&
      !isConnecting &&
      !isManualTyping &&
      autoConnectBlockedPeerKey !== singleDiscoveredPeerKey;

    if (!canAutoConnect || !singleDiscoveredDevice || !singleDiscoveredPeerKey) {
      setAutoConnectCountdown(null);
      return;
    }

    let cancelled = false;

    setAutoConnectCountdown(AUTO_CONNECT_DELAY_SECONDS);

    autoConnectIntervalRef.current = setInterval(() => {
      setAutoConnectCountdown((prev) => {
        if (prev === null) return null;
        return prev > 1 ? prev - 1 : 1;
      });
    }, 1000);

    autoConnectTimeoutRef.current = setTimeout(() => {
      void (async () => {
        if (cancelled) return;

        clearAutoConnectTimers();

        const connected = await connectToDiscoveredDevice(singleDiscoveredDevice, {
          fromAuto: true,
          silentSuccess: true,
        });

        if (!connected && !cancelled) {
          setAutoConnectBlockedPeerKey(singleDiscoveredPeerKey);
        }

        if (!cancelled) {
          setAutoConnectCountdown(null);
        }
      })();
    }, AUTO_CONNECT_DELAY_MS);

    return () => {
      cancelled = true;
      clearAutoConnectTimers();
    };
  }, [
    autoConnectBlockedPeerKey,
    clearAutoConnectTimers,
    connectToDiscoveredDevice,
    input,
    isConnecting,
    singleDiscoveredDevice,
    singleDiscoveredPeerKey,
  ]);

  const handleCancelAutoConnect = useCallback(() => {
    clearAutoConnectTimers();
    setAutoConnectCountdown(null);
    if (singleDiscoveredPeerKey) {
      setAutoConnectBlockedPeerKey(singleDiscoveredPeerKey);
    }
  }, [clearAutoConnectTimers, singleDiscoveredPeerKey]);

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <Text style={styles.title}>Connect Desktop</Text>
      <Text style={styles.subtitle}>Auto-discovery connects in 3s if one desktop is found.</Text>

      <View style={styles.discoveredSection}>
        <View style={styles.discoveredHeader}>
          <Text style={styles.discoveredTitle}>Nearby Desktops</Text>
          {isScanning ? <ActivityIndicator size="small" color="#ffd93d" /> : null}
        </View>

        {discoveredDevices.length === 0 ? (
          <Text style={styles.discoveredEmptyText}>
            {scanError ?? "Scanning for nearby desktop app..."}
          </Text>
        ) : (
          discoveredDevices.map((device, index) => (
            <TVFocusPressable
              key={getPeerKey(device)}
              style={styles.deviceButton}
              onPress={() => {
                handleCancelAutoConnect();
                void connectToDiscoveredDevice(device);
              }}
              hasTVPreferredFocus={index === 0}
              disabled={isConnecting}
            >
              <Text style={styles.deviceName}>{device.name}</Text>
              <Text style={styles.deviceHost}>{device.host}:{device.port}</Text>
            </TVFocusPressable>
          ))
        )}

        {singleDiscoveredDevice && autoConnectCountdown !== null ? (
          <View style={styles.autoConnectBanner}>
            <Text style={styles.autoConnectText}>
              Auto-connecting to {singleDiscoveredDevice.name} in {autoConnectCountdown}s
            </Text>
            <TVFocusPressable style={styles.cancelButton} onPress={handleCancelAutoConnect}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TVFocusPressable>
          </View>
        ) : null}
      </View>

      <View style={styles.inputWrap}>
        <TextInput
          value={pairingCode ?? ""}
          onChangeText={setPairingCode}
          placeholder="Pairing code (desktop Settings → Sync)"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          autoCapitalize="characters"
          autoCorrect={false}
        />
      </View>

      <View style={styles.inputWrap}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="192.168.1.5"
          placeholderTextColor="#64748b"
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <TVFocusPressable
        style={styles.primaryButton}
        onPress={connectToManualInput}
        disabled={isConnecting}
      >
        <Text style={styles.primaryButtonText}>{isConnecting ? "Connecting..." : "Connect Manually"}</Text>
      </TVFocusPressable>

      <TVFocusPressable style={styles.secondaryButton} onPress={() => router.back()}>
        <Text style={styles.secondaryButtonText}>Back</Text>
      </TVFocusPressable>

      {candidates.length > 0 ? (
        <View style={styles.candidatesWrap}>
          <Text style={styles.candidatesTitle}>Manual candidates:</Text>
          {candidates.map((item) => (
            <Text key={item} style={styles.candidateText}>
              {item}
            </Text>
          ))}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#132447",
    paddingHorizontal: 36,
    paddingBottom: 24,
  },
  title: {
    color: "#fff4cc",
    fontSize: 44,
    fontWeight: "900",
  },
  subtitle: {
    marginTop: 8,
    color: "#dbeafe",
    fontSize: 20,
    fontWeight: "600",
  },
  discoveredSection: {
    marginTop: 20,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#8ec5ff",
    backgroundColor: "#2d7ff9",
    padding: 14,
    gap: 10,
  },
  discoveredHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  discoveredTitle: {
    color: "#fffef2",
    fontSize: 24,
    fontWeight: "900",
  },
  discoveredEmptyText: {
    color: "#eaf5ff",
    fontSize: 18,
    fontWeight: "700",
  },
  deviceButton: {
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "#ffd93d",
    backgroundColor: "#40c4aa",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  deviceName: {
    color: "#fffef2",
    fontSize: 20,
    fontWeight: "900",
  },
  deviceHost: {
    color: "#e8fffa",
    fontSize: 16,
    fontWeight: "700",
  },
  autoConnectBanner: {
    marginTop: 4,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#ffd93d",
    backgroundColor: "#ff8a00",
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  autoConnectText: {
    color: "#fffef2",
    fontSize: 18,
    fontWeight: "900",
    flex: 1,
  },
  cancelButton: {
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#ffe48f",
    backgroundColor: "#ff6b6b",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  cancelButtonText: {
    color: "#fffef2",
    fontSize: 18,
    fontWeight: "900",
  },
  inputWrap: {
    marginTop: 18,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#8ec5ff",
    backgroundColor: "#2d7ff9",
    paddingHorizontal: 14,
  },
  input: {
    color: "#fffef2",
    fontSize: 24,
    fontWeight: "800",
    height: 60,
  },
  primaryButton: {
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "#ffd93d",
    backgroundColor: "#ff6b6b",
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignSelf: "flex-start",
  },
  primaryButtonText: {
    color: "#fffef2",
    fontSize: 22,
    fontWeight: "900",
  },
  secondaryButton: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "#ffd93d",
    backgroundColor: "#ff8a00",
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignSelf: "flex-start",
  },
  secondaryButtonText: {
    color: "#fffef2",
    fontSize: 20,
    fontWeight: "900",
  },
  candidatesWrap: {
    marginTop: 20,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "#8ec5ff",
    backgroundColor: "#2d7ff9",
    padding: 12,
    gap: 6,
  },
  candidatesTitle: {
    color: "#fffef2",
    fontSize: 18,
    fontWeight: "900",
  },
  candidateText: {
    color: "#eaf5ff",
    fontSize: 17,
    fontWeight: "700",
  },
});
