import React, { useState } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

const moveItem = <T,>(items: T[], from: number, to: number): T[] => {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};

// A Track list the user rearranges by dragging, or with the arrow keys on a handle.
export function SortableTrackList<T>({
  items,
  getKey,
  onReorder,
  renderItem,
  className,
  itemClassName,
}: {
  items: T[];
  getKey: (item: T) => string;
  onReorder: (items: T[]) => void;
  renderItem: (item: T, index: number) => React.ReactNode;
  className?: string;
  itemClassName?: string;
}): React.JSX.Element {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const finish = (): void => {
    setDragging(null);
    setOver(null);
  };

  const move = (from: number, to: number): void => {
    if (from === to || to < 0 || to >= items.length) return;
    onReorder(moveItem(items, from, to));
  };

  return (
    <ol className={className}>
      {items.map((item, index) => (
        <li
          key={getKey(item)}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            setDragging(index);
          }}
          onDragOver={(event) => {
            if (dragging === null) return;
            event.preventDefault();
            setOver(index);
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (dragging !== null) move(dragging, index);
            finish();
          }}
          onDragEnd={finish}
          className={cn(
            "flex items-center gap-2",
            dragging === index && "opacity-50",
            over === index && dragging !== index && "bg-accent",
            itemClassName
          )}
        >
          <button
            type="button"
            aria-label="Move Track (arrow keys)"
            className="shrink-0 cursor-grab text-muted-foreground hover:text-foreground"
            onKeyDown={(event) => {
              if (event.key === "ArrowUp") move(index, index - 1);
              else if (event.key === "ArrowDown") move(index, index + 1);
              else return;
              event.preventDefault();
            }}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          {renderItem(item, index)}
        </li>
      ))}
    </ol>
  );
}
