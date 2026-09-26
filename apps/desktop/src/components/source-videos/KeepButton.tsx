import React from "react";
import { ChevronDown, ListPlus, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type ListOption = { id: string; name: string };

// Keep, with a menu to Keep and add to a List in one go.
export function KeepButton({
  lists,
  isKeeping,
  onKeep,
  label = "Keep",
  size = "sm",
  className,
}: {
  lists: ListOption[];
  isKeeping: boolean;
  onKeep: (listId?: string) => void;
  label?: string;
  size?: "sm" | "default";
  className?: string;
}): React.JSX.Element {
  return (
    <div className={cn("inline-flex shrink-0", className)} onClick={(e) => e.stopPropagation()}>
      <Button
        size={size}
        className="gap-1 rounded-r-none"
        onClick={() => onKeep()}
        disabled={isKeeping}
      >
        {isKeeping ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Plus className="h-3.5 w-3.5" />
        )}
        {label}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size={size}
            className="rounded-l-none border-l border-primary-foreground/20 px-1.5"
            disabled={isKeeping}
            aria-label="Keep and add to a List"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuLabel className="flex items-center gap-2">
            <ListPlus className="h-4 w-4" />
            Keep and add to List
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {lists.map((list) => (
            <DropdownMenuItem key={list.id} onClick={() => onKeep(list.id)}>
              {list.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
