import { create } from "zustand";
import type { Audiobook } from "../../shared/mobile-sync-contract";

/** The Audiobooks the desktop at `serverUrl` served last, for the Home rows and the book screen. */
export const useAudiobookCatalogStore = create<{
  serverUrl: string | null;
  audiobooks: Audiobook[];
}>()(() => ({ serverUrl: null, audiobooks: [] }));
