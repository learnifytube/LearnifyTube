import React from "react";
import { LayoutGrid, LayoutList, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LibrarySort, LibraryView } from "../library-view";

export type LayoutMode = "grid" | "list";

type Option = { value: string; label: string };

const SORTS: { value: LibrarySort; label: string }[] = [
  { value: "recently-kept", label: "Recently kept" },
  { value: "title", label: "Title" },
  { value: "duration", label: "Duration" },
  { value: "channel", label: "Channel" },
];

const WATCH_STATES: Option[] = [
  { value: "all", label: "Any Watch state" },
  { value: "unwatched", label: "Unwatched" },
  { value: "in-progress", label: "In progress" },
  { value: "watched", label: "Watched" },
];

type Props = {
  view: LibraryView;
  onViewChange: (view: LibraryView) => void;
  layout: LayoutMode;
  onLayoutChange: (layout: LayoutMode) => void;
  channels: Option[];
  lists: Option[];
};

export function LibraryToolbar({
  view,
  onViewChange,
  layout,
  onLayoutChange,
  channels,
  lists,
}: Props): React.JSX.Element {
  const set = (changes: Partial<LibraryView>): void => onViewChange({ ...view, ...changes });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search title or channel..."
          value={view.search}
          onChange={(e) => set({ search: e.target.value })}
          className="w-64 pl-9"
        />
      </div>
      <FilterSelect
        value={view.sort}
        options={SORTS}
        onChange={(sort) => set({ sort: sort as LibrarySort })}
        label="Sort"
      />
      <FilterSelect
        value={view.watchState}
        options={WATCH_STATES}
        onChange={(watchState) => set({ watchState: watchState as LibraryView["watchState"] })}
        label="Watch state"
      />
      <FilterSelect
        value={view.channelId}
        options={[{ value: "all", label: "Any Channel" }, ...channels]}
        onChange={(channelId) => set({ channelId })}
        label="Channel"
      />
      <FilterSelect
        value={view.listId}
        options={[{ value: "all", label: "Any List" }, ...lists]}
        onChange={(listId) => set({ listId })}
        label="List"
      />
      <div className="ml-auto flex items-center rounded-md border">
        <Button
          variant={layout === "grid" ? "secondary" : "ghost"}
          size="sm"
          className="rounded-r-none"
          onClick={() => onLayoutChange("grid")}
          aria-label="Grid"
        >
          <LayoutGrid className="h-4 w-4" />
        </Button>
        <Button
          variant={layout === "list" ? "secondary" : "ghost"}
          size="sm"
          className="rounded-l-none"
          onClick={() => onLayoutChange("list")}
          aria-label="List"
        >
          <LayoutList className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function FilterSelect({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  label: string;
}): React.JSX.Element {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-40" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
