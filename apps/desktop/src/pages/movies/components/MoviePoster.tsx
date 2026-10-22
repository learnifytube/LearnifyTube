import React from "react";
import { Film } from "lucide-react";
import Thumbnail from "@/components/Thumbnail";
import { cn } from "@/lib/utils";

const POSTER_CLASS = "aspect-[2/3] w-full rounded-lg object-cover";

// A saved poster (app-owned file), a preview data URL, or the placeholder.
export function MoviePoster({
  posterPath,
  posterDataUrl,
  title,
  className,
}: {
  posterPath?: string | null;
  posterDataUrl?: string | null;
  title: string;
  className?: string;
}): React.JSX.Element {
  if (posterDataUrl) {
    return <img src={posterDataUrl} alt={title} className={cn(POSTER_CLASS, className)} />;
  }
  if (!posterPath) {
    return (
      <div
        className={cn(POSTER_CLASS, "flex items-center justify-center bg-muted", className)}
        aria-label={title}
      >
        <Film className="h-10 w-10 text-muted-foreground" />
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg">
      <Thumbnail
        thumbnailPath={posterPath}
        alt={title}
        className={cn(POSTER_CLASS, className)}
        fallbackIcon={<Film className="h-10 w-10 text-muted-foreground" />}
      />
    </div>
  );
}
