import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Brain, Target, Clock, Video } from "lucide-react";
import { LEARNING_FEATURES_ENABLED } from "@/lib/features";

type QuickStatsRowProps = {
  totalWords: number;
  retentionRate: number;
  weeklyMinutes: number;
  totalVideos: number;
  isLoading?: boolean;
};

export function QuickStatsRow({
  totalWords,
  retentionRate,
  weeklyMinutes,
  totalVideos,
  isLoading,
}: QuickStatsRowProps): React.JSX.Element {
  const learningStats = [
    {
      label: "Words Learned",
      value: totalWords,
      icon: Brain,
      color: "text-purple-500",
      bgColor: "bg-purple-50 dark:bg-purple-950/30",
    },
    {
      label: "Retention",
      value: `${retentionRate}%`,
      icon: Target,
      color: "text-green-500",
      bgColor: "bg-green-50 dark:bg-green-950/30",
    },
  ];
  const stats = [
    ...(LEARNING_FEATURES_ENABLED ? learningStats : []),
    {
      label: "This Week",
      value: formatTime(weeklyMinutes),
      icon: Clock,
      color: "text-blue-500",
      bgColor: "bg-blue-50 dark:bg-blue-950/30",
    },
    {
      label: "In Library",
      value: totalVideos,
      icon: Video,
      color: "text-orange-500",
      bgColor: "bg-orange-50 dark:bg-orange-950/30",
    },
  ];

  if (isLoading) {
    return (
      <div
        className={`grid grid-cols-2 gap-3 ${LEARNING_FEATURES_ENABLED ? "sm:grid-cols-4" : ""}`}
      >
        {stats.map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
                <div className="space-y-1">
                  <div className="h-5 w-12 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-16 animate-pulse rounded bg-muted" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-2 gap-3 ${LEARNING_FEATURES_ENABLED ? "sm:grid-cols-4" : ""}`}>
      {stats.map((stat) => (
        <Card key={stat.label} className="transition-shadow hover:shadow-md">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`rounded-lg p-2.5 ${stat.bgColor}`}>
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
              </div>
              <div>
                <p className="text-xl font-bold">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

const formatTime = (minutes: number): string => {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${mins}m`;
};
