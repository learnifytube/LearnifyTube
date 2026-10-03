import { useState } from "react";
import {
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
import { desktopConnection } from "../../services/desktop-connection";
import { describeConnectionProblem } from "../../components/tv/connectionText";
import { TVFocusPressable } from "../../components/tv/TVFocusPressable";
import { verifyDesktopUrl } from "../../services/verify-desktop";
import type { DiscoveredPeer } from "../../types";

function getPeerKey(peer: DiscoveredPeer): string {
  return `${peer.name}|${peer.host}|${peer.port}`;
}

export default function TVConnectScreen() {
  const connection = desktopConnection.useConnection();
  const savedCode = useConnectionStore((state) => state.pairingCode);

  const [code, setCode] = useState(savedCode ?? "");
  const [address, setAddress] = useState(verifyDesktopUrl ?? "");
  const [isPairing, setIsPairing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const pair = async (target?: string) => {
    setIsPairing(true);
    setFailure(null);
    const result = await desktopConnection.pair(code, target);
    setIsPairing(false);
    if (result.status === "connected") {
      router.back();
      return;
    }
    setFailure(describeConnectionProblem(result));
  };

  const peers = connection.peers;

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <Text style={styles.title}>Connect to desktop</Text>
      <Text style={styles.subtitle}>
        Enter the pairing code shown in desktop Settings → Sync.
      </Text>

      <View style={styles.inputWrap}>
        <TextInput
          testID="pairing-code-input"
          accessibilityLabel="Pairing code"
          value={code}
          onChangeText={setCode}
          placeholder="Pairing code"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          autoCapitalize="characters"
          autoCorrect={false}
          hasTVPreferredFocus
        />
      </View>

      <View style={styles.discoveredSection}>
        <View style={styles.discoveredHeader}>
          <Text style={styles.discoveredTitle}>Nearby desktops</Text>
          {peers.length === 0 ? (
            <ActivityIndicator size="small" color="#ffd93d" />
          ) : null}
        </View>

        {peers.length === 0 ? (
          <Text style={styles.discoveredEmptyText}>
            Looking for your desktop…
          </Text>
        ) : (
          peers.map((peer) => (
            <TVFocusPressable
              key={getPeerKey(peer)}
              style={styles.deviceButton}
              onPress={() => void pair(`${peer.host}:${peer.port}`)}
              disabled={isPairing}
            >
              <Text style={styles.deviceName}>{peer.name}</Text>
              <Text style={styles.deviceHost}>
                {peer.host}:{peer.port}
              </Text>
            </TVFocusPressable>
          ))
        )}
      </View>

      <View style={styles.inputWrap}>
        <TextInput
          value={address}
          onChangeText={setAddress}
          placeholder="Desktop address (optional), e.g. 192.168.1.5"
          placeholderTextColor="#64748b"
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {failure ? <Text style={styles.failureText}>{failure}</Text> : null}

      <View style={styles.actions}>
        <TVFocusPressable
          testID="tv-connect-submit"
          accessibilityLabel="Connect"
          style={styles.primaryButton}
          onPress={() => void pair(address.trim() || undefined)}
          disabled={isPairing}
        >
          <Text style={styles.primaryButtonText}>
            {isPairing ? "Connecting…" : "Connect"}
          </Text>
        </TVFocusPressable>

        <TVFocusPressable
          style={styles.secondaryButton}
          onPress={() => router.back()}
        >
          <Text style={styles.secondaryButtonText}>Back</Text>
        </TVFocusPressable>
      </View>
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
    fontSize: 36,
    fontWeight: "900",
  },
  subtitle: {
    marginTop: 8,
    color: "#dbeafe",
    fontSize: 20,
    fontWeight: "600",
  },
  discoveredSection: {
    marginTop: 14,
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
  inputWrap: {
    marginTop: 14,
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
  actions: {
    marginTop: 14,
    flexDirection: "row",
    gap: 12,
  },
  failureText: {
    marginTop: 12,
    color: "#ffe3e3",
    fontSize: 18,
    fontWeight: "700",
  },
  primaryButton: {
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
});
