import {
  useEffect,
  useState,
  useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  FlatList,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useConnectionStore } from "../../../stores/connection";
import { api } from "../../../services/api";
import * as wordsRepo from "../../../db/repositories/words";
import * as flashcardsRepo from "../../../db/repositories/flashcards";
import type { RemoteFlashcard, RemoteSavedWord } from "../../../types";

type StudyMode = "flashcards" | "words";

export default function FlashcardsScreen() {
  const router = useRouter();
  const serverUrl = useConnectionStore((s) => s.serverUrl);
  const isConnected = serverUrl !== null;

  const [mode, setMode] = useState<StudyMode>("flashcards");

  const [cards, setCards] = useState<RemoteFlashcard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [savedWords, setSavedWords] = useState<RemoteSavedWord[]>([]);
  const [isLoadingWords, setIsLoadingWords] = useState(false);
  const [wordsError, setWordsError] = useState<string | null>(null);

  const syncPendingFlashcardReviews = useCallback(async () => {
    if (!serverUrl) {
      return;
    }

    const pendingReviews = flashcardsRepo.getPendingFlashcardReviewsLocal();
    for (const review of pendingReviews) {
      await api.reviewFlashcard(serverUrl, review.flashcardId, review.grade);
      flashcardsRepo.removePendingFlashcardReviewLocal(review.id);
    }
  }, [serverUrl]);

  const loadCards = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const localCards = flashcardsRepo.getDueFlashcardsLocal();
    setCards(localCards);
    setCurrentIndex(0);
    setIsFlipped(false);
    setSessionComplete(false);
    setReviewedCount(0);

    try {
      if (!serverUrl) {
        return;
      }

      const hasPendingReviews =
        flashcardsRepo.getPendingFlashcardReviewsLocal().length > 0;
      let shouldRefreshFromDesktop = true;

      try {
        await syncPendingFlashcardReviews();
      } catch (syncError) {
        shouldRefreshFromDesktop = !hasPendingReviews;
        console.log("[Flashcards] Failed to sync pending reviews:", syncError);
      }

      if (shouldRefreshFromDesktop) {
        const result = await api.getFlashcards(serverUrl, false);
        flashcardsRepo.replaceRemoteFlashcards(result.flashcards);
      }

      const refreshedCards = flashcardsRepo.getDueFlashcardsLocal();
      setCards(refreshedCards);
      setCurrentIndex(0);
      setIsFlipped(false);
      setSessionComplete(false);
      setReviewedCount(0);
    } catch (e) {
      console.log("[Flashcards] Failed to load:", e);
      if (flashcardsRepo.getDueFlashcardsLocal().length === 0) {
        setError("Could not refresh flashcards from desktop");
      }
    } finally {
      setIsLoading(false);
    }
  }, [serverUrl, syncPendingFlashcardReviews]);

  const loadSavedWords = useCallback(async () => {
    setIsLoadingWords(true);
    setWordsError(null);
    try {
      setSavedWords(wordsRepo.getAllSavedWordsLocal());

      if (serverUrl) {
        const result = await api.getSavedWords(serverUrl);
        wordsRepo.upsertRemoteSavedWords(result.words);
        setSavedWords(wordsRepo.getAllSavedWordsLocal());
      }
    } catch (e) {
      console.log("[Flashcards] Failed to load saved words:", e);
      setWordsError("Could not refresh saved words from desktop");
    } finally {
      setIsLoadingWords(false);
    }
  }, [serverUrl]);

  useEffect(() => {
    if (mode === "flashcards") {
      loadCards();
    }
  }, [mode, loadCards]);

  useEffect(() => {
    if (mode === "words") {
      void loadSavedWords();
    }
  }, [mode, loadSavedWords]);

  const handleGrade = useCallback(
    async (grade: number) => {
      if (isReviewing) return;
      const card = cards[currentIndex];
      if (!card) return;

      setIsReviewing(true);
      try {
        flashcardsRepo.applyFlashcardReviewLocal(card.id, grade);
        flashcardsRepo.queueFlashcardReviewLocal(card.id, grade);

        if (serverUrl) {
          try {
            await syncPendingFlashcardReviews();
          } catch (syncError) {
            console.log("[Flashcards] Review sync deferred:", syncError);
          }
        }

        setReviewedCount((c) => c + 1);
        const remainingCards = flashcardsRepo.getDueFlashcardsLocal();

        if (remainingCards.length === 0) {
          setCards([]);
          setSessionComplete(true);
        } else {
          setCards(remainingCards);
          setCurrentIndex((i) => Math.min(i, remainingCards.length - 1));
          setIsFlipped(false);
          setSessionComplete(false);
        }
      } catch (e) {
        console.log("[Flashcards] Review failed:", e);
      } finally {
        setIsReviewing(false);
      }
    },
    [serverUrl, cards, currentIndex, isReviewing, syncPendingFlashcardReviews]
  );

  const renderWords = () => {
    if (isLoadingWords && savedWords.length === 0) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#e94560" />
          <Text style={styles.loadingText}>Loading saved words...</Text>
        </View>
      );
    }

    if (savedWords.length === 0) {
      return (
        <View style={styles.centered}>
          <Text style={styles.icon}>📚</Text>
          <Text style={styles.title}>No Saved Words Yet</Text>
          <Text style={styles.description}>
            Tap words in transcript while watching videos to save them.
          </Text>
          <Pressable style={styles.retryButton} onPress={loadSavedWords}>
            <Text style={styles.retryButtonText}>Refresh</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <FlatList
        style={{ flex: 1 }}
        data={savedWords}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.wordsList}
        ListHeaderComponent={
          <View style={styles.wordsHeaderRow}>
            <Text style={styles.wordsCountLabel}>{savedWords.length} words</Text>
            <Pressable
              style={styles.wordsRefreshButton}
              onPress={loadSavedWords}
              disabled={isLoadingWords}
            >
              <Text style={styles.wordsRefreshText}>
                {isLoadingWords ? "Refreshing..." : "Refresh"}
              </Text>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.wordCard}>
            <View style={styles.wordMainRow}>
              <Text style={styles.wordSource}>{item.sourceText}</Text>
              <Text style={styles.wordArrow}>→</Text>
              <Text style={styles.wordTranslated}>{item.translatedText}</Text>
            </View>
            <View style={styles.wordMetaRow}>
              <Text style={styles.wordLang}>
                {item.sourceLang} → {item.targetLang}
              </Text>
              {item.reviewCount > 0 && (
                <Text style={styles.wordReviews}>{item.reviewCount} reviews</Text>
              )}
            </View>
          </View>
        )}
        ListFooterComponent={
          wordsError ? <Text style={styles.wordsErrorText}>{wordsError}</Text> : null
        }
      />
    );
  };

  const renderFlashcards = () => {
    if (isLoading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#e94560" />
          <Text style={styles.loadingText}>Loading flashcards...</Text>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.centered}>
          <Text style={styles.icon}>⚠️</Text>
          <Text style={styles.description}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={loadCards}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </Pressable>
        </View>
      );
    }

    if (sessionComplete) {
      return (
        <View style={styles.centered}>
          <Text style={styles.icon}>🎉</Text>
          <Text style={styles.title}>Session Complete!</Text>
          <Text style={styles.description}>
            You reviewed {reviewedCount} card{reviewedCount !== 1 ? "s" : ""}
          </Text>
          <Pressable style={styles.retryButton} onPress={loadCards}>
            <Text style={styles.retryButtonText}>Study Again</Text>
          </Pressable>
        </View>
      );
    }

    if (cards.length === 0) {
      return (
        <View style={styles.centered}>
          <Text style={styles.icon}>{isConnected ? "✅" : "📚"}</Text>
          <Text style={styles.title}>
            {isConnected ? "All Caught Up!" : "No Local Flashcards Yet"}
          </Text>
          <Text style={styles.description}>
            {isConnected
              ? "No flashcards due for review. Create more on your desktop app."
              : "Connect to your desktop app once to sync flashcards for offline study."}
          </Text>
          <Pressable
            style={styles.retryButton}
            onPress={
              isConnected ? loadCards : () => router.push("/(mobile)/connect")
            }
          >
            <Text style={styles.retryButtonText}>
              {isConnected ? "Refresh" : "Connect desktop"}
            </Text>
          </Pressable>
        </View>
      );
    }

    const card = cards[currentIndex];

    return (
      <>
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                { width: `${((currentIndex + 1) / cards.length) * 100}%` },
              ]}
            />
          </View>
          <Text style={styles.progressText}>
            {currentIndex + 1} / {cards.length}
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.cardScrollContent}
          style={styles.cardScroll}
        >
          <Pressable
            style={styles.card}
            onPress={() => setIsFlipped((f) => !f)}
          >
            {!isFlipped ? (
              <>
                <Text style={styles.cardLabel}>FRONT</Text>
                <Text style={styles.cardContent}>{card.frontContent}</Text>
                {card.contextText && (
                  <Text style={styles.cardContext}>"{card.contextText}"</Text>
                )}
                <Text style={styles.tapHint}>Tap to reveal answer</Text>
              </>
            ) : (
              <>
                <Text style={styles.cardLabel}>BACK</Text>
                <Text style={styles.cardContent}>{card.backContent}</Text>
                <Text style={[styles.cardLabel, { marginTop: 16 }]}>FRONT</Text>
                <Text style={styles.cardFrontPreview}>{card.frontContent}</Text>
              </>
            )}
          </Pressable>
        </ScrollView>

        {isFlipped && (
          <View style={styles.gradeContainer}>
            <Text style={styles.gradeLabel}>How well did you know this?</Text>
            <View style={styles.gradeButtons}>
              <Pressable
                style={[styles.gradeButton, styles.gradeAgain]}
                onPress={() => handleGrade(1)}
                disabled={isReviewing}
              >
                <Text style={styles.gradeEmoji}>😣</Text>
                <Text style={styles.gradeText}>Again</Text>
              </Pressable>
              <Pressable
                style={[styles.gradeButton, styles.gradeHard]}
                onPress={() => handleGrade(3)}
                disabled={isReviewing}
              >
                <Text style={styles.gradeEmoji}>😐</Text>
                <Text style={styles.gradeText}>Hard</Text>
              </Pressable>
              <Pressable
                style={[styles.gradeButton, styles.gradeGood]}
                onPress={() => handleGrade(4)}
                disabled={isReviewing}
              >
                <Text style={styles.gradeEmoji}>😊</Text>
                <Text style={styles.gradeText}>Good</Text>
              </Pressable>
              <Pressable
                style={[styles.gradeButton, styles.gradeEasy]}
                onPress={() => handleGrade(5)}
                disabled={isReviewing}
              >
                <Text style={styles.gradeEmoji}>🤩</Text>
                <Text style={styles.gradeText}>Easy</Text>
              </Pressable>
            </View>
          </View>
        )}
      </>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.modeTabs}>
        <Pressable
          style={[styles.modeTab, mode === "flashcards" && styles.modeTabActive]}
          onPress={() => setMode("flashcards")}
        >
          <Text
            style={[
              styles.modeTabText,
              mode === "flashcards" && styles.modeTabTextActive,
            ]}
          >
            Flashcards
          </Text>
        </Pressable>
        <Pressable
          style={[styles.modeTab, mode === "words" && styles.modeTabActive]}
          onPress={() => setMode("words")}
        >
          <Text
            style={[styles.modeTabText, mode === "words" && styles.modeTabTextActive]}
          >
            My Words
          </Text>
        </Pressable>
      </View>

      {mode === "flashcards" ? renderFlashcards() : renderWords()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f0f23",
  },
  modeTabs: {
    flexDirection: "row",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 10,
  },
  modeTab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2b2b44",
    backgroundColor: "#12122a",
    paddingVertical: 10,
  },
  modeTabActive: {
    borderColor: "#e94560",
    backgroundColor: "#2a1320",
  },
  modeTabText: {
    color: "#a0a0b8",
    fontSize: 13,
    fontWeight: "600",
  },
  modeTabTextActive: {
    color: "#fff",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  icon: {
    fontSize: 64,
    marginBottom: 16,
  },
  title: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 8,
    textAlign: "center",
  },
  description: {
    color: "#a0a0a0",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 22,
  },
  loadingText: {
    color: "#a0a0a0",
    fontSize: 14,
    marginTop: 16,
  },
  retryButton: {
    backgroundColor: "#e94560",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  progressContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  progressBar: {
    flex: 1,
    height: 6,
    backgroundColor: "#1a1a2e",
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#e94560",
    borderRadius: 3,
  },
  progressText: {
    color: "#a0a0a0",
    fontSize: 13,
    fontWeight: "500",
    minWidth: 50,
    textAlign: "right",
  },
  cardScroll: {
    flex: 1,
  },
  cardScrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  card: {
    backgroundColor: "#1a1a2e",
    borderRadius: 16,
    padding: 24,
    minHeight: 300,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2a2a40",
  },
  cardLabel: {
    color: "#e94560",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 1,
    marginBottom: 12,
  },
  cardContent: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 16,
    lineHeight: 38,
  },
  cardContext: {
    color: "#8b9dc3",
    fontSize: 16,
    textAlign: "center",
    fontStyle: "italic",
    marginBottom: 16,
  },
  tapHint: {
    color: "#666",
    fontSize: 13,
    marginTop: 8,
  },
  cardFrontPreview: {
    color: "#8b9dc3",
    fontSize: 18,
    textAlign: "center",
  },
  gradeContainer: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 6,
    backgroundColor: "#0f0f23",
  },
  gradeLabel: {
    color: "#a0a0a0",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 10,
  },
  gradeButtons: {
    flexDirection: "row",
    gap: 8,
  },
  gradeButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  gradeAgain: {
    backgroundColor: "#7f1d1d",
  },
  gradeHard: {
    backgroundColor: "#92400e",
  },
  gradeGood: {
    backgroundColor: "#14532d",
  },
  gradeEasy: {
    backgroundColor: "#1e3a8a",
  },
  gradeEmoji: {
    fontSize: 20,
    marginBottom: 4,
  },
  gradeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  wordsList: {
    paddingHorizontal: 16,
    paddingBottom: 18,
    gap: 10,
  },
  wordsHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
    marginBottom: 6,
  },
  wordsCountLabel: {
    color: "#8b9dc3",
    fontSize: 13,
    fontWeight: "600",
  },
  wordsRefreshButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e94560",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  wordsRefreshText: {
    color: "#e94560",
    fontSize: 12,
    fontWeight: "600",
  },
  wordCard: {
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#2a2a40",
    marginBottom: 10,
  },
  wordMainRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 8,
  },
  wordSource: {
    flex: 1,
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  wordArrow: {
    color: "#8b9dc3",
    fontSize: 15,
  },
  wordTranslated: {
    flex: 1,
    color: "#00d4aa",
    fontSize: 16,
    fontWeight: "500",
    textAlign: "right",
  },
  wordMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  wordLang: {
    color: "#8b9dc3",
    fontSize: 12,
    textTransform: "uppercase",
  },
  wordReviews: {
    color: "#fbbf24",
    fontSize: 12,
    fontWeight: "500",
  },
  wordsErrorText: {
    color: "#fca5a5",
    fontSize: 12,
    marginTop: 4,
    textAlign: "center",
  },
});
