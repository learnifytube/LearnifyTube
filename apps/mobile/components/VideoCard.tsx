import {
  View,
  Text,
  StyleSheet,
  Image,
  Pressable,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Link, type Href } from "expo-router";
import type { Video } from "../types";
import { useDownloadStore } from "../stores/downloads";
import { downloadManager } from "../services/downloadManager";
import { offlineCopy } from "../services/offline-copy";
import { colors, radius, spacing, fontSize, fontWeight } from "../theme";
import { Check, AlertCircle, Film } from "../theme/icons";

interface VideoCardProps {
  video: Video;
  style?: StyleProp<ViewStyle>;
  playerHref?: Href;
  resumeLabel?: string;
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function VideoCard({
  video,
  style,
  playerHref,
  resumeLabel,
}: VideoCardProps) {
  const download = useDownloadStore((state) =>
    state.queue.find((d) => d.videoId === video.id)
  );

  const isDownloaded = offlineCopy.useUri(video.id) !== null;
  const isDownloading = download?.status === "downloading";
  const isQueued = download?.status === "queued";
  const isFailed = download?.status === "failed";

  const handleCancel = () => {
    downloadManager.cancel(video.id);
  };

  const handleRetry = () => {
    downloadManager.retry(video.id);
  };

  const href = playerHref ?? (`/player/${video.id}` as Href);

  return (
    <Link href={href} asChild>
      <Pressable
        style={({ pressed }) =>
          StyleSheet.flatten([
            styles.container,
            style,
            pressed && styles.containerPressed,
          ])
        }
      >
        <View style={styles.thumbnailContainer}>
          {video.thumbnailUrl ? (
            <Image
              source={{ uri: video.thumbnailUrl }}
              style={styles.thumbnail}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
              <Film size={24} color={colors.mutedForeground} />
            </View>
          )}
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>
              {formatDuration(video.duration)}
            </Text>
          </View>
          {isQueued && (
            <View style={styles.pendingOverlay}>
              <Text style={styles.pendingText}>Queued</Text>
            </View>
          )}
          {isDownloading && (
            <View style={styles.progressOverlay}>
              <View
                style={[
                  styles.progressBar,
                  { width: `${download?.progress || 0}%` },
                ]}
              />
              <Text style={styles.progressText}>{download?.progress || 0}%</Text>
            </View>
          )}
          {isFailed && (
            <View style={styles.failedBadge}>
              <AlertCircle size={12} color={colors.foreground} />
            </View>
          )}
          {isDownloaded && !download && (
            <View style={styles.downloadedBadge}>
              <Check size={12} color={colors.foreground} strokeWidth={3} />
            </View>
          )}
        </View>
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={2}>
            {video.title}
          </Text>
          <Text style={styles.channel} numberOfLines={1}>
            {video.channelTitle}
          </Text>
          {resumeLabel ? (
            <Text style={styles.resumeLabel} numberOfLines={1}>
              {resumeLabel}
            </Text>
          ) : null}
          {(isDownloading || isQueued) && (
            <Pressable style={styles.cancelButton} onPress={handleCancel}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          )}
          {isFailed && (
            <View style={styles.failedActions}>
              <Text style={styles.errorText} numberOfLines={1}>
                {download?.error || "Failed"}
              </Text>
              <Pressable style={styles.retryButton} onPress={handleRetry}>
                <Text style={styles.retryButtonText}>Retry</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    margin: spacing.sm,
    maxWidth: "50%",
    borderRadius: radius.lg,
    padding: spacing.xs,
  },
  containerPressed: {
    opacity: 0.88,
  },
  thumbnailContainer: {
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.card,
  },
  thumbnail: {
    width: "100%",
    height: "100%",
  },
  thumbnailPlaceholder: {
    justifyContent: "center",
    alignItems: "center",
  },
  durationBadge: {
    position: "absolute",
    bottom: 4,
    right: 4,
    backgroundColor: colors.overlay,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  durationText: {
    color: colors.foreground,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  progressOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 20,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    alignItems: "center",
  },
  progressBar: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.primary,
  },
  progressText: {
    color: colors.foreground,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    zIndex: 1,
  },
  pendingOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 20,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    alignItems: "center",
  },
  pendingText: {
    color: colors.mutedForeground,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  failedBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.destructive,
    justifyContent: "center",
    alignItems: "center",
  },
  downloadedBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.success,
    justifyContent: "center",
    alignItems: "center",
  },
  info: {
    paddingTop: spacing.xs + 2,
  },
  title: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    marginBottom: 2,
    lineHeight: 16,
  },
  channel: {
    color: colors.mutedForeground,
    fontSize: fontSize.xs,
  },
  resumeLabel: {
    marginTop: 4,
    color: colors.primary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  cancelButton: {
    marginTop: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
    backgroundColor: `${colors.destructive}33`,
    borderRadius: radius.sm,
    alignSelf: "flex-start",
  },
  cancelButtonText: {
    color: colors.destructive,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  failedActions: {
    marginTop: 4,
  },
  errorText: {
    color: colors.destructive,
    fontSize: 9,
    marginBottom: 4,
  },
  retryButton: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    backgroundColor: `${colors.primary}33`,
    borderRadius: radius.sm,
    alignSelf: "flex-start",
  },
  retryButtonText: {
    color: colors.primary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
});
