import React from "react";
import { BookAudio } from "lucide-react";
import Thumbnail from "@/components/Thumbnail";
import { cn } from "@/lib/utils";

const COVER_CLASS = "aspect-square w-full rounded-lg object-cover";

// A saved cover (app-owned file), a preview data URL, or the placeholder.
export function AudiobookCover({
  coverPath,
  coverDataUrl,
  title,
  className,
}: {
  coverPath?: string | null;
  coverDataUrl?: string | null;
  title: string;
  className?: string;
}): React.JSX.Element {
  const placeholder = (
    <div
      className={cn(COVER_CLASS, "flex items-center justify-center bg-muted", className)}
      aria-label={title}
    >
      <BookAudio className="h-10 w-10 text-muted-foreground" />
    </div>
  );
  if (coverDataUrl) {
    return <img src={coverDataUrl} alt={title} className={cn(COVER_CLASS, className)} />;
  }
  if (!coverPath) return placeholder;
  return (
    <div className="overflow-hidden rounded-lg">
      <Thumbnail
        thumbnailPath={coverPath}
        alt={title}
        className={cn(COVER_CLASS, className)}
        fallbackIcon={<BookAudio className="h-10 w-10 text-muted-foreground" />}
      />
    </div>
  );
}
