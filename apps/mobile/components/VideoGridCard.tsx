import {
    View,
    Text,
    Image,
    StyleSheet,
    ActivityIndicator,
    Pressable,
} from "react-native";
import { colors, radius, spacing, fontSize, fontWeight } from "../theme";
import { Film } from "../theme/icons";

export interface VideoGridCardData {
    id: string;
    title: string;
    channelTitle: string;
    duration: number;
    thumbnailUrl?: string | null;
}

type PendingState =
    | { type: "none" }
    | { type: "preparing"; label?: string }
    | { type: "downloading"; progress: number }
    | { type: "queued" }
    | { type: "failed"; error?: string };

interface VideoGridCardProps {
    video: VideoGridCardData;
    pending?: PendingState;
    onPress: () => void;
    onLongPress?: () => void;
    onCancelPress?: () => void;
    subtitle?: string;
}

function formatDuration(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
    return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function VideoGridCard({
    video,
    pending = { type: "none" },
    onPress,
    onLongPress,
    onCancelPress,
    subtitle,
}: VideoGridCardProps) {
    const isPending = pending.type !== "none" && pending.type !== "failed";

    return (
        <Pressable
            style={({ pressed }) => [styles.card, pressed && !isPending && styles.cardPressed]}
            onPress={onPress}
            onLongPress={onLongPress}
            disabled={isPending}
        >
            <View style={styles.thumbnailContainer}>
                {video.thumbnailUrl ? (
                    <Image source={{ uri: video.thumbnailUrl }} style={styles.thumbnail} resizeMode="cover" />
                ) : (
                    <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
                        <Film size={24} color={colors.mutedForeground} />
                    </View>
                )}

                {/* Duration badge */}
                <View style={styles.durationBadge}>
                    <Text style={styles.durationText}>{formatDuration(video.duration)}</Text>
                </View>

                {/* Preparing overlay */}
                {pending.type === "preparing" && (
                    <View style={styles.overlay}>
                        <ActivityIndicator size="small" color={colors.foreground} />
                        <Text style={styles.overlayText}>{pending.label || "Preparing..."}</Text>
                    </View>
                )}

                {/* Download progress overlay */}
                {pending.type === "downloading" && (
                    <View style={styles.overlay}>
                        <View style={styles.progressBarTrack}>
                            <View style={[styles.progressBarFill, { width: `${pending.progress}%` }]} />
                        </View>
                        <Text style={styles.overlayText}>{pending.progress}%</Text>
                    </View>
                )}

                {/* Queued overlay */}
                {pending.type === "queued" && (
                    <View style={styles.overlay}>
                        <Text style={styles.overlayText}>Queued</Text>
                    </View>
                )}

                {/* Failed badge */}
                {pending.type === "failed" && (
                    <View style={styles.failedOverlay}>
                        <Text style={styles.failedText}>Failed</Text>
                    </View>
                )}
            </View>

            <Text style={styles.title} numberOfLines={2}>
                {video.title}
            </Text>
            <Text style={styles.channel} numberOfLines={1}>
                {video.channelTitle}
            </Text>
            {subtitle ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                    {subtitle}
                </Text>
            ) : null}

            {/* Cancel button when pending */}
            {isPending && onCancelPress && (
                <Pressable
                    style={styles.cancelButton}
                    onPress={onCancelPress}
                >
                    <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
            )}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: {
        flex: 1,
        marginHorizontal: spacing.xs,
        marginBottom: spacing.md,
    },
    cardPressed: {
        opacity: 0.8,
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
    overlay: {
        position: "absolute",
        inset: 0,
        backgroundColor: colors.overlay,
        justifyContent: "center",
        alignItems: "center",
        gap: 6,
    },
    overlayText: {
        color: colors.foreground,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
    },
    progressBarTrack: {
        width: "60%",
        height: 4,
        backgroundColor: "rgba(255,255,255,0.2)",
        borderRadius: 2,
        overflow: "hidden",
    },
    progressBarFill: {
        height: "100%",
        backgroundColor: colors.primary,
        borderRadius: 2,
    },
    failedOverlay: {
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: `${colors.destructive}CC`,
        paddingVertical: 3,
        alignItems: "center",
    },
    failedText: {
        color: colors.foreground,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
    },
    title: {
        color: colors.foreground,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        marginTop: spacing.xs + 2,
        lineHeight: 16,
    },
    channel: {
        color: colors.mutedForeground,
        fontSize: fontSize.xs,
        marginTop: 2,
    },
    subtitle: {
        color: colors.primary,
        fontSize: fontSize.xs,
        marginTop: 2,
        fontWeight: fontWeight.medium,
    },
    cancelButton: {
        marginTop: 4,
        paddingVertical: 3,
        paddingHorizontal: 8,
        backgroundColor: `${colors.destructive}33`,
        borderRadius: radius.sm,
        alignSelf: "flex-start",
    },
    cancelText: {
        color: colors.destructive,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.medium,
    },
});
