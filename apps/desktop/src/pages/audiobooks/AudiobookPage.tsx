import React from "react";
import { Link, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import { PageContainer } from "@/components/ui/page-container";
import { AudiobookCover } from "./components/AudiobookCover";
import { formatListeningTime } from "./format";

// A Track's path shown from the book's folder, e.g. "CD 1/Track 01.mp3".
const insideFolder = (folder: string, filePath: string): string =>
  filePath.startsWith(folder) ? filePath.slice(folder.length).replace(/^[\\/]/, "") : filePath;

export default function AudiobookPage(): React.JSX.Element {
  const { id } = useSearch({ from: "/audiobook" });
  const bookQuery = useQuery({
    queryKey: ["audiobooks", "get", id],
    queryFn: () => trpcClient.audiobooks.get.query({ id }),
    enabled: Boolean(id),
  });
  const book = bookQuery.data;

  return (
    <PageContainer>
      <Link
        to="/audiobooks"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Audiobooks
      </Link>

      {bookQuery.isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {!bookQuery.isLoading && !book && (
        <p className="text-sm text-muted-foreground">This Audiobook is no longer here.</p>
      )}

      {book && (
        <div className="flex flex-col gap-6 sm:flex-row">
          <div className="w-48 shrink-0">
            <AudiobookCover coverPath={book.coverPath} title={book.title} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">{book.title}</h1>
            {book.author && <p className="text-muted-foreground">{book.author}</p>}
            <p className="mt-1 break-all text-xs text-muted-foreground">{book.sourceFolder}</p>

            <h2 className="mt-6 text-sm font-semibold">{book.tracks.length} Tracks</h2>
            <ol className="mt-2 divide-y rounded-lg border">
              {book.tracks.map((track, index) => (
                <li key={track.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="w-6 shrink-0 text-right text-xs text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={track.filePath}>
                    {insideFolder(book.sourceFolder, track.filePath)}
                  </span>
                  {track.missing && <span className="text-xs text-destructive">Missing</span>}
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatListeningTime(track.durationSeconds)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
