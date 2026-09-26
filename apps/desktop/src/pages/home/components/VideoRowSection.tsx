import React from "react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type VideoRowSectionProps = {
  title: string;
  icon: LucideIcon;
  isLoading?: boolean;
  isEmpty: boolean;
  emptyTitle: string;
  emptyHint: string;
  children: React.ReactNode;
};

// A Home section: a titled, horizontally scrolling row of Video cards
export function VideoRowSection({
  title,
  icon: Icon,
  isLoading,
  isEmpty,
  emptyTitle,
  emptyHint,
  children,
}: VideoRowSectionProps): React.JSX.Element {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Icon className="h-5 w-5 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex gap-4 overflow-x-auto pb-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="w-64 flex-shrink-0">
                <div className="aspect-video w-full animate-pulse rounded-lg bg-muted" />
                <div className="mt-2 space-y-1">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center gap-1 py-6 text-center">
            <p className="font-medium">{emptyTitle}</p>
            <p className="text-sm text-muted-foreground">{emptyHint}</p>
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-2">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}
