import React from "react";
import { Check } from "lucide-react";

interface TranscriptWordProps {
  word: string;
  isHovered: boolean;
  hasTranslation: boolean;
  translation?: { translatedText: string; targetLang: string; queryCount: number } | null;
  showInlineTranslations: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClick?: () => void;
  isSaving?: boolean;
  justSaved?: boolean;
}

export function TranscriptWord({
  word,
  isHovered,
  hasTranslation,
  translation,
  showInlineTranslations,
  onMouseEnter,
  onMouseLeave,
  onClick,
  isSaving,
  justSaved,
}: TranscriptWordProps): React.JSX.Element {
  // Don't wrap whitespace - just render as space
  if (/^\s+$/.test(word)) {
    return <span className="w-1" />;
  }

  const handleClick = (e: React.MouseEvent): void => {
    // Only trigger quick save on double-click to avoid interfering with selection
    if (e.detail === 2 && onClick && word.trim()) {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    }
  };

  return (
    <span
      className={`inline-flex flex-col items-center transition-all duration-100 ${
        justSaved
          ? "-mx-0.5 scale-110 rounded bg-green-200 px-1 dark:bg-green-500/30"
          : isSaving
            ? "-mx-0.5 scale-105 animate-pulse rounded bg-yellow-100 px-1 dark:bg-yellow-500/20"
            : isHovered
              ? "-mx-0.5 scale-105 rounded bg-yellow-200 px-1 dark:bg-yellow-500/30"
              : hasTranslation
                ? "-mx-0.5 rounded px-1 hover:bg-blue-100 dark:hover:bg-blue-900/30"
                : "-mx-0.5 rounded px-1 hover:bg-muted/50"
      }`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={handleClick}
      style={{
        cursor: word.trim() ? "pointer" : "default",
        minHeight: showInlineTranslations && hasTranslation ? "1.8em" : "auto",
      }}
      title={word.trim() && onClick ? "Double-click to quick save" : undefined}
    >
      <span
        className={`relative ${
          hasTranslation && !isHovered && !justSaved
            ? "font-medium text-blue-600 dark:text-blue-400"
            : justSaved
              ? "font-medium text-green-600 dark:text-green-400"
              : ""
        }`}
      >
        {word}
        {justSaved && (
          <Check className="absolute -right-3 -top-1 h-3 w-3 text-green-500 animate-in fade-in zoom-in" />
        )}
      </span>
      {hasTranslation && showInlineTranslations && translation && (
        <span className="whitespace-nowrap text-[10px] leading-none text-blue-500 opacity-90 dark:text-blue-400">
          {translation.translatedText}
        </span>
      )}
    </span>
  );
}
