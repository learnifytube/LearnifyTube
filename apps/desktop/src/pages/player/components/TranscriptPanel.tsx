import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { trpcClient } from "@/utils/trpc";
import { useAtom } from "jotai";
import { z } from "zod";
import {
  showInlineTranslationsAtom,
  translationTargetLangAtom,
  currentTranscriptLangAtom,
  fontFamilyAtom,
  fontSizeAtom,
  transcriptCollapsedAtom,
  showDualSubtitlesAtom,
  secondarySubtitleLangAtom,
} from "@/context/transcriptSettings";
import { transcriptSelectionAtom } from "@/context/annotations";
import { PlaybackData } from "@/context/playerStore";
import { toast } from "sonner";
import { TranscriptContent } from "./TranscriptContent";
import { TranslationTooltip } from "./TranslationTooltip";
import { LEARNING_FEATURES_ENABLED } from "@/lib/features";
import { TranscriptSettingsDialog } from "./TranscriptSettingsDialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2, Settings as SettingsIcon, ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  filterLanguagesByPreference,
  isInCooldown,
  setCooldown,
  clearCooldown,
} from "../utils/transcriptUtils";

// Zod schema for available language structure
const availableLanguageSchema = z.object({
  lang: z.string(),
  hasManual: z.boolean(),
  hasAuto: z.boolean(),
  manualFormats: z.array(z.string()).optional(),
  autoFormats: z.array(z.string()).optional(),
});

// Zod schema for playback data (prefixed with _ as only used for type inference)
const _playbackDataSchema = z
  .object({
    availableLanguages: z.array(availableLanguageSchema).optional(),
  })
  .passthrough(); // Allow additional fields

type AvailableLanguage = z.infer<typeof availableLanguageSchema>;

interface TranscriptPanelProps {
  videoId: string;
  videoRef: React.RefObject<HTMLVideoElement> | null;
  currentTime: number;
  playbackData: PlaybackData | null;
  onSeekIndicator?: (indicator: { direction: "forward" | "backward"; amount: number }) => void;
}

export function TranscriptPanel({
  videoId,
  videoRef,
  currentTime,
  playbackData,
  onSeekIndicator,
}: TranscriptPanelProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const { toast: toastHook } = useToast();

  // Atoms for settings and shared state
  const [showInlineTranslationsPreference] = useAtom(showInlineTranslationsAtom);
  const showInlineTranslations = LEARNING_FEATURES_ENABLED && showInlineTranslationsPreference;
  const [translationTargetLang] = useAtom(translationTargetLangAtom);
  const [fontFamily] = useAtom(fontFamilyAtom);
  const [fontSize] = useAtom(fontSizeAtom);
  const [, setCurrentTranscriptLang] = useAtom(currentTranscriptLangAtom);
  const [, setTranscriptSelection] = useAtom(transcriptSelectionAtom);
  const [userCollapsed, setUserCollapsed] = useAtom(transcriptCollapsedAtom);

  // Dual Subtitles State
  const [showDualSubtitles] = useAtom(showDualSubtitlesAtom);
  const [secondaryLang] = useAtom(secondarySubtitleLangAtom);

  // Local state
  const [showTranscriptSettings, setShowTranscriptSettings] = useState(false);
  const [selectedLang, setSelectedLang] = useState<string | null>(null);
  const hasAttemptedFetchRef = useRef(false);
  const attemptedDownloadRef = useRef<Set<string>>(new Set());

  // ============================================================================
  // TRANSCRIPT QUERIES (owned by this component)
  // ============================================================================

  // User preferences query
  const userPrefsQuery = useQuery({
    queryKey: ["user-preferences"],
    queryFn: async () => {
      return await trpcClient.preferences.getUserPreferences.query();
    },
  });

  // Fetch video info mutation (when subtitle data is missing)
  const fetchVideoInfoMutation = useMutation({
    mutationFn: async () => {
      if (!videoId) throw new Error("Missing videoId");
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      return await trpcClient.ytdlp.fetchVideoInfo.mutate({ url });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["video-playback", videoId] });
      queryClient.invalidateQueries({ queryKey: ["available-subs", videoId] });
    },
  });

  // Auto-fetch video info when subtitle data is missing
  useEffect(() => {
    if (!videoId) return;
    if (playbackData === undefined) return; // Still loading

    if (
      playbackData !== null &&
      !("availableLanguages" in playbackData) &&
      !fetchVideoInfoMutation.isPending &&
      !fetchVideoInfoMutation.isSuccess &&
      !hasAttemptedFetchRef.current
    ) {
      hasAttemptedFetchRef.current = true;
      fetchVideoInfoMutation.mutate();
    }
  }, [videoId, playbackData, fetchVideoInfoMutation]);

  // Reset attempt flag when videoId changes
  useEffect(() => {
    hasAttemptedFetchRef.current = false;
  }, [videoId]);

  // Available subtitles query
  const availableSubsQuery = useQuery({
    queryKey: ["available-subs", videoId],
    queryFn: async (): Promise<{ languages: AvailableLanguage[] }> => {
      if (!videoId) {
        const emptyLanguages: AvailableLanguage[] = [];
        return { languages: emptyLanguages };
      }

      if (playbackData?.availableLanguages) {
        return { languages: playbackData.availableLanguages };
      }

      const emptyLanguages: AvailableLanguage[] = [];
      return { languages: emptyLanguages };
    },
    enabled: !!videoId && playbackData !== undefined,
    initialData:
      playbackData?.availableLanguages !== undefined
        ? { languages: playbackData.availableLanguages }
        : undefined,
  });

  // Filter languages by user preferences
  const filteredLanguages = useMemo(
    () =>
      filterLanguagesByPreference(
        availableSubsQuery.data?.languages || [],
        userPrefsQuery.data?.preferredLanguages || []
      ),
    [availableSubsQuery.data, userPrefsQuery.data]
  );

  // Validate selected language is available
  useEffect(() => {
    const available = (availableSubsQuery.data?.languages ?? []).map((l) => l.lang);
    if (selectedLang && !available.includes(selectedLang)) {
      toastHook({
        title: "Subtitle not available",
        description: `No transcript available in ${selectedLang.toUpperCase()} for this video. Showing default transcript instead.`,
        variant: "destructive",
      });
      setSelectedLang(null);
    }
  }, [availableSubsQuery.data, selectedLang, toastHook]);

  // Transcript query
  const transcriptQuery = useQuery({
    queryKey: ["transcript", videoId, selectedLang ?? "__default__"],
    queryFn: async () => {
      if (!videoId) return null;
      if (selectedLang) {
        return await trpcClient.transcripts.get.query({ videoId, lang: selectedLang });
      }
      return await trpcClient.transcripts.get.query({ videoId });
    },
    enabled: !!videoId,
    placeholderData: (prev) => prev,
  });

  const transcriptData = transcriptQuery.data;
  const effectiveLang = selectedLang ?? transcriptData?.language;

  // Update shared atom when language changes (for Sidebar)
  useEffect(() => {
    setCurrentTranscriptLang(effectiveLang ?? undefined);
  }, [effectiveLang, setCurrentTranscriptLang]);

  // Clear download attempt when transcript loads
  useEffect(() => {
    if (transcriptData) {
      const key = `${videoId}|${selectedLang ?? "__default__"}`;
      attemptedDownloadRef.current.delete(key);
    }
  }, [videoId, selectedLang, transcriptData]);

  // Transcript segments query
  const transcriptSegmentsQuery = useQuery({
    queryKey: ["transcript-segments", videoId, effectiveLang ?? "__default__"],
    queryFn: async () => {
      if (!videoId) return { segments: [] };
      return await trpcClient.transcripts.getSegments.query({
        videoId,
        lang: effectiveLang ?? undefined,
      });
    },
    enabled: !!videoId,
    placeholderData: (prev) => prev,
  });

  const segments = transcriptSegmentsQuery.data?.segments ?? [];

  // Secondary Transcript segments query (for Dual Subtitles)
  const secondarySegmentsQuery = useQuery({
    queryKey: ["transcript-segments", videoId, secondaryLang],
    queryFn: async () => {
      if (!videoId || !showDualSubtitles || !secondaryLang) return { segments: [] };
      // Prevent fetching same language twice
      if (secondaryLang === effectiveLang) return { segments: [] };

      return await trpcClient.transcripts.getSegments.query({
        videoId,
        lang: secondaryLang,
      });
    },
    enabled: !!videoId && showDualSubtitles && !!secondaryLang && secondaryLang !== effectiveLang,
    staleTime: Infinity,
  });

  const secondarySegments = secondarySegmentsQuery.data?.segments ?? undefined;

  // Derived collapsed state: force collapsed if no segments, otherwise use user preference
  const isCollapsed = segments.length === 0 ? true : userCollapsed;

  // Download transcript mutation
  const downloadTranscriptMutation = useMutation({
    mutationFn: async (lang?: string) => {
      if (!videoId) throw new Error("Missing videoId");
      return await trpcClient.transcripts.download.mutate({
        videoId,
        lang: lang ?? selectedLang ?? undefined,
      });
    },
    onSuccess: (response, lang) => {
      const targetLang = lang ?? selectedLang;

      if (!videoId) return;

      if (response.success) {
        queryClient.invalidateQueries({
          queryKey: ["transcript", videoId, targetLang ?? "__default__"],
        });
        queryClient.invalidateQueries({
          queryKey: ["transcript-segments", videoId, targetLang ?? "__default__"],
        });
        // Also invalidate generic if downloading default
        if (!targetLang) {
          queryClient.invalidateQueries({ queryKey: ["transcript-segments", videoId] });
        }

        clearCooldown(videoId, targetLang);
        return;
      }

      if ("code" in response && response.code === "RATE_LIMITED") {
        setCooldown(videoId, targetLang, response.retryAfterMs);
        toastHook({
          title: "Rate limited by YouTube",
          description: `Too many requests. Try again in about ${Math.ceil(response.retryAfterMs / 60000)} min`,
          variant: "destructive",
        });
        return;
      }

      toastHook({
        title: "Transcript download failed",
        description: response.message,
        variant: "destructive",
      });
    },
  });

  // Auto-download secondary subtitle if enabled and missing
  useEffect(() => {
    if (!videoId || !showDualSubtitles || !secondaryLang) return;

    // Check if we have segments
    const hasSegments =
      secondarySegmentsQuery.data?.segments && secondarySegmentsQuery.data.segments.length > 0;
    const isLoaded = secondarySegmentsQuery.isSuccess;

    // If loaded, empty, and not attempted yet
    const attemptKey = `${videoId}|${secondaryLang}`;

    if (
      isLoaded &&
      !hasSegments &&
      !attemptedDownloadRef.current.has(attemptKey) &&
      !downloadTranscriptMutation.isPending
    ) {
      // Check availability strictly if possible, but for now we try download
      // We only try if standard "availableSubs" showed it?
      // Actually, let's just try downloading. ytdlp helper will handle finding it or auto-translating if backend supports it.
      // But user said "only download if turn on dual language". We are inside that check.
      // User implied "only if not available". "Not available" locally = empty segments.

      // Auto-download secondary language subtitle
      attemptedDownloadRef.current.add(attemptKey);
      downloadTranscriptMutation.mutate(secondaryLang);
    }
  }, [
    videoId,
    showDualSubtitles,
    secondaryLang,
    secondarySegmentsQuery.data,
    secondarySegmentsQuery.isSuccess,
  ]);

  const [activeSegIndex, setActiveSegIndex] = useState<number | null>(null);
  const [followPlayback, setFollowPlayback] = useState<boolean>(true);
  const [isSelecting, setIsSelecting] = useState<boolean>(false);
  const [isHovering, setIsHovering] = useState<boolean>(false);
  const [hoveredWord, setHoveredWord] = useState<string | null>(null);
  const [isHoveringTooltip, setIsHoveringTooltip] = useState<boolean>(false);
  const [hoverTranslation, setHoverTranslation] = useState<{
    word: string;
    translation: string;
    translationId: string;
    loading: boolean;
    saved?: boolean;
  } | null>(null);
  const [savingWord, setSavingWord] = useState<string | null>(null);
  const [justSavedWord, setJustSavedWord] = useState<string | null>(null);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  const segRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  const isSnappingRef = useRef<boolean>(false);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const translateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSeekingRef = useRef<boolean>(false);

  // Handle text selection - update sidebar state via atom
  const handleTranscriptSelect = (): void => {
    const selection = window.getSelection()?.toString() || "";
    if (selection.length > 0) {
      const cleaned = selection.trim();
      if (cleaned.length > 0) {
        setTranscriptSelection({
          trigger: Date.now(),
          selectedText: cleaned,
          currentTime,
        });
      }
    }
  };

  // Handle Enter key - trigger annotation focus at current time
  const handleEnterKey = (): void => {
    setTranscriptSelection({
      trigger: Date.now(),
      currentTime,
    });
  };

  // Mutation for saving words to My Words
  const saveWordMutation = useMutation({
    mutationFn: async (translationId: string) => {
      return await trpcClient.translation.saveWord.mutate({ translationId });
    },
    onSuccess: (data) => {
      // Update the hover translation to show it's saved
      setHoverTranslation((prev) => (prev ? { ...prev, saved: true } : null));

      // Show success toast
      toast.success(data.alreadySaved ? "Word already in My Words" : "Word saved to My Words! 📚");

      // Invalidate saved words queries to refresh transcript highlights and MyWords page
      queryClient.invalidateQueries({ queryKey: ["saved-words"] });
      queryClient.invalidateQueries({ queryKey: ["saved-words-all"] });
      queryClient.invalidateQueries({ queryKey: ["translation", "savedWordsByVideo"] });
    },
    onError: (error) => {
      toast.error("Failed to save word: " + String(error));
    },
  });

  // Fetch all saved words (for inline highlighting across all videos)
  const { data: savedWords } = useQuery({
    queryKey: ["saved-words-all"],
    queryFn: async () => {
      return await trpcClient.translation.getAllSavedWords.query();
    },
    enabled: showInlineTranslations,
    staleTime: 60000, // Cache for 1 minute - saved words may change when user adds/removes
  });

  // Build efficient lookup map for saved words (memoized)
  const translationMap = useMemo((): Map<
    string,
    { translatedText: string; targetLang: string; queryCount: number }
  > => {
    if (!savedWords || !showInlineTranslations) {
      return new Map<string, { translatedText: string; targetLang: string; queryCount: number }>();
    }

    const map = new Map<
      string,
      { translatedText: string; targetLang: string; queryCount: number }
    >();

    savedWords.forEach((t) => {
      // Index by exact match (lowercase, trimmed)
      const cleanSource = t.sourceText.toLowerCase().trim();
      map.set(cleanSource, {
        translatedText: t.translatedText,
        targetLang: t.targetLang,
        queryCount: t.queryCount,
      });

      // Also index without punctuation for better matching
      const noPunctuation = t.sourceText
        .replace(/[.,!?;:'"()[\]{}]/g, "")
        .toLowerCase()
        .trim();
      if (noPunctuation !== cleanSource && noPunctuation.length > 0) {
        map.set(noPunctuation, {
          translatedText: t.translatedText,
          targetLang: t.targetLang,
          queryCount: t.queryCount,
        });
      }
    });

    return map;
  }, [savedWords, showInlineTranslations]);

  // Get translation for a word (O(1) lookup)
  const getTranslationForWord = useCallback(
    (word: string): { translatedText: string; targetLang: string; queryCount: number } | null => {
      if (!showInlineTranslations || translationMap.size === 0) return null;

      const cleanWord = word.toLowerCase().trim();
      const translation = translationMap.get(cleanWord);

      // If not found, try without punctuation
      if (!translation) {
        const noPunctuation = word
          .replace(/[.,!?;:'"()[\]{}]/g, "")
          .toLowerCase()
          .trim();
        return translationMap.get(noPunctuation) ?? null;
      }

      return translation;
    },
    [translationMap, showInlineTranslations]
  );

  // Quick save handler - translate and save word in one action (double-click)
  const handleQuickSave = useCallback(
    async (word: string): Promise<void> => {
      // Clean the word
      const cleanWord = word
        .replace(/[.,!?;:'"()[\]{}]/g, "")
        .toLowerCase()
        .trim();
      if (!cleanWord || cleanWord.length < 2) return;

      // Check if already saved
      const existingTranslation = getTranslationForWord(word);
      if (existingTranslation) {
        toast.info("Word already saved");
        return;
      }

      // Set saving state
      setSavingWord(cleanWord);

      try {
        // Get current timestamp for context
        const timestamp =
          activeSegIndex !== null && segments[activeSegIndex]
            ? segments[activeSegIndex].start
            : currentTime;

        // Get context text
        const contextText =
          activeSegIndex !== null && segments[activeSegIndex] ? segments[activeSegIndex].text : "";

        // Translate the word
        const result = await trpcClient.utils.translateText.query({
          text: cleanWord,
          targetLang: translationTargetLang,
          sourceLang: "auto",
          videoId,
          timestampSeconds: Math.floor(timestamp),
          contextText,
        });

        if (result.success && result.translationId) {
          // Save the word
          await trpcClient.translation.saveWord.mutate({ translationId: result.translationId });

          // Show success feedback
          setJustSavedWord(cleanWord);
          toast.success(`"${cleanWord}" saved! 📚`);

          // Invalidate queries to refresh
          queryClient.invalidateQueries({ queryKey: ["saved-words"] });
          queryClient.invalidateQueries({ queryKey: ["saved-words-all"] });
          queryClient.invalidateQueries({ queryKey: ["translation", "savedWordsByVideo"] });

          // Clear justSaved state after animation
          setTimeout(() => setJustSavedWord(null), 1500);
        } else {
          toast.error("Failed to translate word");
        }
      } catch {
        toast.error("Failed to save word");
      } finally {
        setSavingWord(null);
      }
    },
    [
      activeSegIndex,
      segments,
      currentTime,
      translationTargetLang,
      videoId,
      queryClient,
      getTranslationForWord,
    ]
  );

  // Handle word hover with debouncing and automatic translation
  const handleWordMouseEnter = async (word: string): Promise<void> => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    if (translateTimeoutRef.current) {
      clearTimeout(translateTimeoutRef.current);
    }

    setHoveredWord(word);
    setIsHovering(true);

    // Check if word already has a translation in cache
    const existingTranslation = getTranslationForWord(word);
    if (existingTranslation) {
      // Already translated, no need to call API
      return;
    }

    // Clean the word (remove punctuation)
    const cleanWord = word.replace(/[.,!?;:'"()[\]{}]/g, "").trim();
    if (!cleanWord || cleanWord.length < 2) return;

    // Set up timer to trigger translation after 800ms of hovering
    translateTimeoutRef.current = setTimeout(async () => {
      try {
        // Show loading state
        setHoverTranslation({ word: cleanWord, translation: "", translationId: "", loading: true });

        // Get current timestamp for context
        const timestamp =
          activeSegIndex !== null && segments[activeSegIndex]
            ? segments[activeSegIndex].start
            : currentTime;

        // Get context text (current segment)
        const contextText =
          activeSegIndex !== null && segments[activeSegIndex] ? segments[activeSegIndex].text : "";

        // Call translation API (this will cache it automatically)
        const result = await trpcClient.utils.translateText.query({
          text: cleanWord,
          targetLang: translationTargetLang, // From transcript settings atom
          sourceLang: "auto", // Auto-detect source language
          videoId,
          timestampSeconds: Math.floor(timestamp),
          contextText,
        });

        if (result.success && result.translation && result.translationId) {
          setHoverTranslation({
            word: cleanWord,
            translation: result.translation,
            translationId: result.translationId, // Get translationId from response
            loading: false,
            saved: false,
          });
        } else {
          setHoverTranslation(null);
        }
      } catch (error) {
        // Translation failed, silently reset
        setHoverTranslation(null);
      }
    }, 800); // 800ms hover delay before translation
  };

  const handleWordMouseLeave = (): void => {
    // Clear translation timer if user stops hovering
    if (translateTimeoutRef.current) {
      clearTimeout(translateTimeoutRef.current);
    }

    // Add small delay before clearing hover to allow moving to tooltip
    hoverTimeoutRef.current = setTimeout(() => {
      // Only hide if not hovering over the tooltip
      if (!isHoveringTooltip) {
        setHoveredWord(null);
        setIsHovering(false);
        setHoverTranslation(null);
      }
    }, 150); // Slightly longer delay to allow moving to tooltip
  };

  // Handle tooltip hover to keep it visible
  const handleTooltipMouseEnter = (): void => {
    setIsHoveringTooltip(true);
    // Clear any pending hide timeout
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
  };

  const handleTooltipMouseLeave = (): void => {
    setIsHoveringTooltip(false);
    // Hide after leaving tooltip
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredWord(null);
      setIsHovering(false);
      setHoverTranslation(null);
    }, 100);
  };

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
      if (translateTimeoutRef.current) {
        clearTimeout(translateTimeoutRef.current);
      }
    };
  }, []);

  // Wheel event handling for seeking within transcript
  useEffect(() => {
    if (!videoRef) return;
    const container = transcriptContainerRef.current;
    const video = videoRef.current;
    if (!container || !video || segments.length === 0) return;

    const handleWheel = (e: WheelEvent): void => {
      // Throttle: Ignore wheel events if we're already seeking
      if (isSeekingRef.current) {
        e.preventDefault();
        return;
      }

      // Prevent default scrolling (transcript is not scrollable)
      e.preventDefault();

      // Mark as seeking
      isSeekingRef.current = true;

      // Determine seek direction and amount
      const seekAmount = 5; // seconds per scroll tick
      const direction = e.deltaY < 0 ? "backward" : "forward";
      const delta = direction === "backward" ? -seekAmount : seekAmount;

      // Seek the video
      const newTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + delta));
      video.currentTime = newTime;

      // Trigger shared seek indicator via callback
      onSeekIndicator?.({ direction, amount: seekAmount });

      // Reset seeking flag after a short delay
      setTimeout(() => {
        isSeekingRef.current = false;
      }, 200);
    };

    // Add wheel listener with passive: false to allow preventDefault
    container.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      container.removeEventListener("wheel", handleWheel);
      isSeekingRef.current = false;
    };
  }, [videoRef, segments.length, onSeekIndicator]);

  // Handle word hover with translation

  // Snap selection to word boundaries
  const snapToWordBoundaries = useCallback(() => {
    if (isSnappingRef.current) return; // Prevent infinite loop

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    if (range.collapsed) return; // No selection

    try {
      isSnappingRef.current = true;

      const startContainer = range.startContainer;
      const endContainer = range.endContainer;

      // Function to expand to word boundary
      const expandToWordBoundary = (
        container: Node,
        offset: number,
        isStart: boolean
      ): { container: Node; offset: number } => {
        if (container.nodeType === Node.TEXT_NODE && container.textContent) {
          const text = container.textContent;
          let newOffset = offset;

          if (isStart) {
            // Move backwards to find word start
            while (newOffset > 0 && /\S/.test(text[newOffset - 1])) {
              newOffset--;
            }
          } else {
            // Move forwards to find word end
            while (newOffset < text.length && /\S/.test(text[newOffset])) {
              newOffset++;
            }
          }

          return { container, offset: newOffset };
        }

        return { container, offset };
      };

      // Expand start to word boundary
      const newStart = expandToWordBoundary(startContainer, range.startOffset, true);

      // Expand end to word boundary
      const newEnd = expandToWordBoundary(endContainer, range.endOffset, false);

      // Create new range with expanded boundaries
      const newRange = document.createRange();
      newRange.setStart(newStart.container, newStart.offset);
      newRange.setEnd(newEnd.container, newEnd.offset);

      // Apply new range
      selection.removeAllRanges();
      selection.addRange(newRange);
    } catch {
      // Ignore errors
    } finally {
      isSnappingRef.current = false;
    }
  }, []);

  // Track selection state and snap to word boundaries
  useEffect(() => {
    const handleSelectionChange = (): void => {
      if (!transcriptContainerRef.current) return;

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        setIsSelecting(false);
        return;
      }

      // Check if selection is within transcript container
      const range = selection.getRangeAt(0);
      const container = transcriptContainerRef.current;

      if (container.contains(range.commonAncestorContainer)) {
        // Set selecting state if there's an active selection
        const hasSelection = !range.collapsed && selection.toString().trim().length > 0;
        setIsSelecting(hasSelection);

        // Snap to word boundaries after a brief delay
        if (hasSelection) {
          setTimeout(() => snapToWordBoundaries(), 10);
        }
      } else {
        setIsSelecting(false);
      }
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [snapToWordBoundaries]);

  // Active segment index based on current time (freeze when selecting or hovering)
  useEffect(() => {
    if (!segments.length) {
      setActiveSegIndex(null);
      return;
    }
    // Don't update active segment while user is selecting text or hovering over word/tooltip
    if (isSelecting || isHovering || isHoveringTooltip) {
      return;
    }

    // First try to find exact match (currentTime within segment range)
    let idx = segments.findIndex((s) => currentTime >= s.start && currentTime < s.end);

    // If no exact match, find the closest segment
    if (idx < 0) {
      // Find the segment that's closest to currentTime
      let closestIdx = 0;
      let minDistance = Math.abs(segments[0].start - currentTime);

      for (let i = 1; i < segments.length; i++) {
        const distance = Math.min(
          Math.abs(segments[i].start - currentTime),
          Math.abs(segments[i].end - currentTime)
        );
        if (distance < minDistance) {
          minDistance = distance;
          closestIdx = i;
        }
      }
      idx = closestIdx;
    }

    const finalIndex = idx >= 0 ? idx : null;
    setActiveSegIndex(finalIndex);
  }, [currentTime, segments, isSelecting, isHovering, isHoveringTooltip, activeSegIndex]);

  // Scroll active segment into view (freeze when selecting or hovering)
  useEffect(() => {
    if (activeSegIndex === null || !followPlayback) return;
    // Don't auto-scroll while user is selecting text or hovering over word/tooltip
    if (isSelecting || isHovering || isHoveringTooltip) return;

    const el = segRefs.current[activeSegIndex];
    const cont = transcriptContainerRef.current;
    if (!el || !cont) return;
    const elTop = el.offsetTop;
    const targetScroll = Math.max(0, elTop - cont.clientHeight * 0.3);
    cont.scrollTo({ top: targetScroll, behavior: "smooth" });
  }, [activeSegIndex, followPlayback, isSelecting, isHovering, isHoveringTooltip]);

  // Handle mousedown to detect selection start
  const handleMouseDown = (): void => {
    // Set a flag that selection might be starting
    // The actual selection state will be updated by selectionchange listener
  };

  // Handle mouseup to finalize selection
  const handleMouseUp = (): void => {
    // Let the selectionchange event handle the state update
    // This is just to ensure we capture the end of selection
  };

  // Keyboard navigation within transcript container
  const handleTranscriptKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!segments.length) return;
    if (!videoRef) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = activeSegIndex === null ? 0 : Math.min(segments.length - 1, activeSegIndex + 1);
      const t = segments[next].start + 0.05;
      if (videoRef.current) {
        videoRef.current.currentTime = t;
        videoRef.current.pause();
      }
      setActiveSegIndex(next);
      setFollowPlayback(false);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = activeSegIndex === null ? 0 : Math.max(0, activeSegIndex - 1);
      const t = segments[prev].start + 0.05;
      if (videoRef.current) {
        videoRef.current.currentTime = t;
        videoRef.current.pause();
      }
      setActiveSegIndex(prev);
      setFollowPlayback(false);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const idx = activeSegIndex ?? 0;
      const t = segments[idx]?.start ?? 0;
      if (videoRef.current) {
        videoRef.current.currentTime = t;
        videoRef.current.pause();
      }
      // Open annotation form at current time
      handleEnterKey();
      return;
    }
  };

  return (
    <>
      <div className="space-y-3 lg:col-span-2">
        {!isCollapsed && (
          <div className="relative">
            <TranscriptContent
              segments={segments}
              secondarySegments={secondarySegments}
              activeSegIndex={activeSegIndex}
              fontFamily={fontFamily}
              fontSize={fontSize}
              showInlineTranslations={showInlineTranslations}
              hoveredWord={hoveredWord}
              translationMap={translationMap}
              onMouseDown={handleMouseDown}
              onMouseUp={() => {
                handleMouseUp();
                handleTranscriptSelect();
              }}
              onKeyDown={handleTranscriptKeyDown}
              onWordMouseEnter={LEARNING_FEATURES_ENABLED ? handleWordMouseEnter : () => {}}
              onWordMouseLeave={LEARNING_FEATURES_ENABLED ? handleWordMouseLeave : () => {}}
              onWordClick={LEARNING_FEATURES_ENABLED ? handleQuickSave : undefined}
              isSelecting={isSelecting}
              containerRef={transcriptContainerRef}
              segRefs={segRefs}
              savingWord={savingWord}
              justSavedWord={justSavedWord}
            />

            {/* Translation Tooltip - appears on long hover */}
            {LEARNING_FEATURES_ENABLED && hoverTranslation && (
              <TranslationTooltip
                word={hoverTranslation.word}
                translation={hoverTranslation.translation}
                translationId={hoverTranslation.translationId}
                loading={hoverTranslation.loading}
                saved={hoverTranslation.saved}
                isSaving={saveWordMutation.isPending}
                onSave={() => {
                  if (hoverTranslation.translationId) {
                    saveWordMutation.mutate(hoverTranslation.translationId);
                  }
                }}
                onMouseEnter={handleTooltipMouseEnter}
                onMouseLeave={handleTooltipMouseLeave}
              />
            )}
          </div>
        )}

        {/* Controls at bottom */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
          {/* Left side - hint text */}
          {LEARNING_FEATURES_ENABLED && !isCollapsed && segments.length > 0 && (
            <p className="text-xs italic text-muted-foreground">
              💡 Hover to translate • Double-click to quick save • Saved words in blue
            </p>
          )}
          {isCollapsed && (
            <div className="flex items-center gap-2">
              {segments.length === 0 ? (
                <>
                  <p className="text-xs italic text-muted-foreground">No transcript available</p>
                  {!transcriptData && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => downloadTranscriptMutation.mutate(undefined)}
                      disabled={downloadTranscriptMutation.isPending}
                      className="h-6 text-xs"
                    >
                      {downloadTranscriptMutation.isPending ? (
                        <>
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          Downloading...
                        </>
                      ) : (
                        "Download Transcript"
                      )}
                    </Button>
                  )}
                </>
              ) : (
                <p className="text-xs italic text-muted-foreground">Transcript collapsed</p>
              )}
            </div>
          )}

          {/* Right side - controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Language selector */}
            {!isCollapsed && filteredLanguages.length > 0 && (
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-muted-foreground">Language:</label>
                <select
                  className="rounded border bg-background px-2 py-1 text-xs hover:bg-muted/30"
                  value={selectedLang ?? effectiveLang ?? ""}
                  onChange={(e) => setSelectedLang(e.target.value)}
                  disabled={availableSubsQuery.isLoading || downloadTranscriptMutation.isPending}
                >
                  {filteredLanguages.map((l) => (
                    <option key={l.lang} value={l.lang}>
                      {l.lang}
                      {l.hasManual ? "" : " (auto)"}
                    </option>
                  ))}
                  {filteredLanguages.length === 0 && (
                    <option value={effectiveLang ?? "en"}>{effectiveLang ?? "en"}</option>
                  )}
                </select>
              </div>
            )}

            {/* Follow playback toggle */}
            {!isCollapsed && (
              <div className="flex items-center gap-1.5">
                <Switch
                  id="follow-playback"
                  checked={followPlayback}
                  onCheckedChange={setFollowPlayback}
                />
                <label htmlFor="follow-playback" className="text-xs text-muted-foreground">
                  Auto-scroll
                </label>
              </div>
            )}

            {/* Collapse/Expand Toggle */}
            <Button
              variant="outline"
              size="sm"
              disabled={segments.length === 0}
              onClick={() => setUserCollapsed(!userCollapsed)}
              className="h-7"
            >
              {isCollapsed ? (
                <>
                  <ChevronDown className="mr-1.5 h-3.5 w-3.5" />
                  <span className="text-xs">Show</span>
                </>
              ) : (
                <>
                  <ChevronUp className="mr-1.5 h-3.5 w-3.5" />
                  <span className="text-xs">Hide</span>
                </>
              )}
            </Button>

            {/* Transcript Settings Button */}
            {!isCollapsed && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowTranscriptSettings(true)}
                className="h-7"
              >
                <SettingsIcon className="mr-1.5 h-3.5 w-3.5" />
                <span className="text-xs">Settings</span>
              </Button>
            )}

            {/* Status indicators */}
            {!isCollapsed && (
              <div className="flex items-center gap-3">
                {/* Tiny loader (non-blocking) when fetching or downloading */}
                {(transcriptQuery.isFetching ||
                  transcriptSegmentsQuery.isFetching ||
                  downloadTranscriptMutation.isPending) && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Updating…
                  </span>
                )}

                {/* Cooldown badge when rate-limited for this video/language */}
                {(() => {
                  const cooldownInfo = isInCooldown(videoId, selectedLang);
                  return cooldownInfo.inCooldown ? (
                    <span className="text-[10px] text-amber-500">
                      retry in ~{cooldownInfo.minutesRemaining}m
                    </span>
                  ) : null;
                })()}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Transcript Settings Dialog (owned by TranscriptPanel) */}
      <TranscriptSettingsDialog
        open={showTranscriptSettings}
        onOpenChange={setShowTranscriptSettings}
        filteredLanguages={filteredLanguages}
        selectedLang={selectedLang}
        effectiveLang={effectiveLang ?? undefined}
        onLanguageChange={setSelectedLang}
      />
    </>
  );
}
