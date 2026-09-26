import React, { useState } from "react";
import { cn } from "@/lib/utils";
import {
  StickyNote,
  BookOpen,
  Sparkles,
  Brain,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { AnnotationsSidebar } from "@/components/AnnotationsSidebar";
import { VocabularySidebar } from "@/components/VocabularySidebar";
import { AISummarySidebar } from "@/components/AISummarySidebar";
import { QuizSidebar } from "@/components/QuizSidebar";
import { Button } from "@/components/ui/button";
import { LEARNING_FEATURES_ENABLED } from "@/lib/features";

type TabType = "annotations" | "vocabulary" | "ai-summary" | "quiz";

interface VideoToolsPanelProps {
  videoId: string;
  videoRef: React.RefObject<HTMLVideoElement>;
  videoTitle?: string;
  currentTime: number;
}

const TABS = [
  { id: "annotations" as const, label: "Notes", icon: StickyNote, learning: false },
  { id: "vocabulary" as const, label: "Vocab", icon: BookOpen, learning: true },
  { id: "ai-summary" as const, label: "AI", icon: Sparkles, learning: true },
  { id: "quiz" as const, label: "Quiz", icon: Brain, learning: true },
].filter((tab) => LEARNING_FEATURES_ENABLED || !tab.learning);

export function VideoToolsPanel({
  videoId,
  videoRef,
  videoTitle,
  currentTime,
}: VideoToolsPanelProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabType>("annotations");
  const [isOpen, setIsOpen] = useState(true);

  // Collapsed state - just show toggle button
  if (!isOpen) {
    return (
      <div className="flex h-full w-10 flex-col items-center border-l bg-background pt-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setIsOpen(true)}
          title="Open tools panel"
        >
          <PanelRightOpen className="h-4 w-4" />
        </Button>
        {/* Vertical tab icons when collapsed */}
        <div className="mt-4 flex flex-col gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setIsOpen(true);
              }}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              title={tab.label}
            >
              <tab.icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Expanded state
  return (
    <div className="flex h-full w-80 flex-col border-l bg-background">
      {/* Header with tabs and close button */}
      <div className="flex items-center justify-between border-b px-2 py-1.5">
        <div className="flex gap-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              title={tab.label}
            >
              <tab.icon className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">{tab.label}</span>
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setIsOpen(false)}
          title="Close tools panel"
        >
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "annotations" && (
          <AnnotationsSidebar
            videoId={videoId}
            videoRef={videoRef}
            videoTitle={videoTitle}
            currentTime={currentTime}
          />
        )}
        {activeTab === "vocabulary" && (
          <VocabularySidebar videoId={videoId} videoRef={videoRef} videoTitle={videoTitle} />
        )}
        {activeTab === "ai-summary" && (
          <AISummarySidebar videoId={videoId} videoRef={videoRef} videoTitle={videoTitle} />
        )}
        {activeTab === "quiz" && (
          <QuizSidebar videoId={videoId} videoRef={videoRef} videoTitle={videoTitle} />
        )}
      </div>
    </div>
  );
}
