import type { FolderListing } from "@/api/audiobooks/import-plan";
import { scanFolder } from "@/api/audiobooks/scan-folder";

// The last folder listing previewed per picked folder, so confirming a Movies or
// Series Import saves what was previewed.
const previewedListingsByFolder = new Map<string, FolderListing>();

export const previewedListings = {
  // Scans the folder afresh for a new preview.
  rescan: async (folderPath: string): Promise<FolderListing> => {
    previewedListingsByFolder.delete(folderPath);
    return previewedListings.listingFor(folderPath);
  },
  listingFor: async (folderPath: string): Promise<FolderListing> => {
    const cached = previewedListingsByFolder.get(folderPath);
    if (cached) return cached;
    const listing = await scanFolder(folderPath);
    previewedListingsByFolder.set(folderPath, listing);
    return listing;
  },
  previewed: (folderPath: string): FolderListing | undefined =>
    previewedListingsByFolder.get(folderPath),
  done: (folderPath: string): void => {
    previewedListingsByFolder.delete(folderPath);
  },
};
