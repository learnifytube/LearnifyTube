import {
  useState,
  useCallback } from "react";
import { View,
  StyleSheet,
  Text,
  Alert,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLibraryStore } from "../../stores/library";
import { useSharingStore } from "../../stores/sharing";
import {
  ModeSelector,
  VideoShareList,
  ShareStatus,
  PeerList,
  PeerVideoList,
} from "../../components/sharing";
import {
  publishService,
  unpublishService,
  startScanning,
  stopScanning,
} from "../../services/p2p/discovery";
import { startServer, stopServer, DEFAULT_PORT } from "../../services/p2p/server";
import { getPeerVideos, downloadVideoFromPeer } from "../../services/p2p/client";
import { offlineCopy } from "../../services/offline-copy";
import type { DiscoveredPeer, PeerVideo } from "../../types";

type ViewMode = "select" | "share" | "receive";

export default function ShareScreen() {
  const [viewMode, setViewMode] = useState<ViewMode>("select");
  const [selectedMode, setSelectedMode] = useState<"share" | "receive">("share");
  const [selectedShareIds, setSelectedShareIds] = useState<Set<string>>(new Set());
  const [selectedReceiveIds, setSelectedReceiveIds] = useState<Set<string>>(
    new Set()
  );
  const [isLoadingPeerVideos, setIsLoadingPeerVideos] = useState(false);

  const videos = useLibraryStore((state) => state.videos);
  const addVideo = useLibraryStore((state) => state.addVideo);
  const loadVideos = useLibraryStore((state) => state.loadVideos);
  const updateVideo = useLibraryStore((state) => state.updateVideo);
  const downloadedVideos = videos.filter((v) => !!v.localPath);

  const {
    isSharing,
    serverPort,
    setSharing,
    isScanning,
    discoveredPeers,
    selectedPeer,
    peerVideos,
    transfers,
    setScanning,
    addPeer,
    removePeer,
    clearPeers,
    selectPeer,
    setPeerVideos,
    addTransfer,
    updateTransfer,
    reset,
  } = useSharingStore();

  const handleModeSelect = (mode: "share" | "receive") => {
    setSelectedMode(mode);
  };

  const handleContinue = () => {
    if (selectedMode === "share") {
      if (downloadedVideos.length === 0) {
        Alert.alert(
          "No Videos",
          "You don't have any downloaded videos to share."
        );
        return;
      }
      setViewMode("share");
    } else {
      setViewMode("receive");
      startPeerScanning();
    }
  };

  // Share mode handlers
  const toggleShareVideo = (id: string) => {
    setSelectedShareIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAllShareVideos = () => {
    setSelectedShareIds(new Set(downloadedVideos.map((v) => v.id)));
  };

  const deselectAllShareVideos = () => {
    setSelectedShareIds(new Set());
  };

  const handleStartSharing = async () => {
    if (selectedShareIds.size === 0) {
      Alert.alert("No Videos Selected", "Please select videos to share.");
      return;
    }

    try {
      const videosToShare = downloadedVideos.filter((v) =>
        selectedShareIds.has(v.id)
      );
      const port = await startServer(videosToShare, DEFAULT_PORT);
      publishService(port, videosToShare.length, (error) => {
        console.error("mDNS publish error:", error);
      });
      setSharing(true, port);
    } catch (error) {
      Alert.alert("Error", "Failed to start sharing. Please try again.");
      console.error("Start sharing error:", error);
    }
  };

  const handleStopSharing = async () => {
    await stopServer();
    unpublishService();
    setSharing(false);
  };

  // Receive mode handlers
  const startPeerScanning = () => {
    clearPeers();
    setScanning(true);
    startScanning({
      onPeerFound: (peer) => {
        addPeer(peer);
      },
      onPeerLost: (name) => {
        removePeer(name);
      },
      onError: (error) => {
        console.error("Scanning error:", error);
      },
    });
  };

  const handleSelectPeer = async (peer: DiscoveredPeer) => {
    selectPeer(peer);
    setIsLoadingPeerVideos(true);
    setSelectedReceiveIds(new Set());

    try {
      const videos = await getPeerVideos(peer);
      setPeerVideos(videos);
    } catch (error) {
      Alert.alert("Error", "Failed to fetch videos from peer.");
      console.error("Fetch peer videos error:", error);
      selectPeer(null);
    } finally {
      setIsLoadingPeerVideos(false);
    }
  };

  const handleBackToPeerList = () => {
    selectPeer(null);
    setPeerVideos([]);
    setSelectedReceiveIds(new Set());
  };

  const toggleReceiveVideo = (id: string) => {
    setSelectedReceiveIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleDownloadFromPeer = useCallback(async () => {
    if (!selectedPeer || selectedReceiveIds.size === 0) return;

    const videosToDownload = peerVideos.filter((v) =>
      selectedReceiveIds.has(v.id)
    );

    // Add transfers
    for (const video of videosToDownload) {
      addTransfer({
        videoId: video.id,
        title: video.title,
        progress: 0,
        status: "pending",
      });
    }

    // Clear selection
    setSelectedReceiveIds(new Set());

    // Download sequentially
    for (const video of videosToDownload) {
      updateTransfer(video.id, { status: "downloading" });

      try {
        const { videoPath, meta } = await downloadVideoFromPeer(
          selectedPeer,
          video.id,
          (progress) => {
            updateTransfer(video.id, { progress });
          }
        );

        // Add to library, then hand the file to the Offline copy module
        addVideo({
          id: video.id,
          title: video.title,
          channelTitle: video.channelTitle,
          duration: video.duration,
          transcript: meta.transcript,
        });
        await offlineCopy.adopt(video.id, videoPath);
        loadVideos();

        updateTransfer(video.id, { status: "completed", progress: 100 });
      } catch (error) {
        console.error(`Download failed for ${video.id}:`, error);
        updateTransfer(video.id, { status: "failed" });
      }
    }
  }, [
    selectedPeer,
    selectedReceiveIds,
    peerVideos,
    addTransfer,
    updateTransfer,
    addVideo,
    loadVideos,
  ]);

  const handleBack = async () => {
    if (viewMode === "share") {
      if (isSharing) {
        await handleStopSharing();
      }
      setViewMode("select");
    } else if (viewMode === "receive") {
      if (selectedPeer) {
        handleBackToPeerList();
      } else {
        stopScanning();
        clearPeers();
        setScanning(false);
        setViewMode("select");
      }
    }
  };

  // Mode selection view
  if (viewMode === "select") {
    return (
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <View style={styles.content}>
          <Text style={styles.title}>P2P Video Sharing</Text>
          <Text style={styles.subtitle}>
            Share videos with nearby devices on the same WiFi network
          </Text>

          <ModeSelector selected={selectedMode} onSelect={handleModeSelect} />

          <View style={styles.footer}>
            <Pressable style={styles.continueButton} onPress={handleContinue}>
              <Text style={styles.continueButtonText}>Continue</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Share mode view
  if (viewMode === "share") {
    return (
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Pressable onPress={handleBack} style={styles.backButton}>
              <Text style={styles.backText}>‹ Back</Text>
            </Pressable>
            <Text style={styles.headerTitle}>Share Videos</Text>
          </View>

          {isSharing ? (
            <ShareStatus
              isSharing={isSharing}
              videoCount={selectedShareIds.size}
              port={serverPort}
              onStop={handleStopSharing}
            />
          ) : (
            <>
              <VideoShareList
                videos={downloadedVideos}
                selectedIds={selectedShareIds}
                onToggle={toggleShareVideo}
                onSelectAll={selectAllShareVideos}
                onDeselectAll={deselectAllShareVideos}
              />

              <View style={styles.actionFooter}>
                <Pressable
                  style={[
                    styles.startButton,
                    selectedShareIds.size === 0 && styles.startButtonDisabled,
                  ]}
                  onPress={handleStartSharing}
                  disabled={selectedShareIds.size === 0}
                >
                  <Text style={styles.startButtonText}>Start Sharing</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // Receive mode view
  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.content}>
        {!selectedPeer && (
          <View style={styles.header}>
            <Pressable onPress={handleBack} style={styles.backButton}>
              <Text style={styles.backText}>‹ Back</Text>
            </Pressable>
            <Text style={styles.headerTitle}>Receive Videos</Text>
          </View>
        )}

        {selectedPeer ? (
          <PeerVideoList
            peer={selectedPeer}
            videos={peerVideos}
            isLoading={isLoadingPeerVideos}
            selectedIds={selectedReceiveIds}
            transfers={transfers}
            onToggle={toggleReceiveVideo}
            onBack={handleBackToPeerList}
            onDownload={handleDownloadFromPeer}
          />
        ) : (
          <PeerList
            peers={discoveredPeers}
            isScanning={isScanning}
            selectedPeer={selectedPeer}
            onSelectPeer={handleSelectPeer}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#16213e",
  },
  content: {
    flex: 1,
    padding: 20,
  },
  title: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 8,
    textAlign: "center",
  },
  subtitle: {
    color: "#a0a0a0",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 32,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
    gap: 12,
  },
  backButton: {
    padding: 4,
  },
  backText: {
    color: "#e94560",
    fontSize: 16,
    fontWeight: "500",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "600",
    flex: 1,
  },
  footer: {
    marginTop: "auto",
    paddingTop: 20,
  },
  continueButton: {
    backgroundColor: "#e94560",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  continueButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  actionFooter: {
    paddingTop: 16,
  },
  startButton: {
    backgroundColor: "#4ade80",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  startButtonDisabled: {
    opacity: 0.5,
  },
  startButtonText: {
    color: "#000",
    fontSize: 16,
    fontWeight: "600",
  },
});
