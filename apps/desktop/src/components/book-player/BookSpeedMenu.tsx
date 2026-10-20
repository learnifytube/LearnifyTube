import React from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BOOK_SPEEDS, bookPlayer, useBookSpeed } from "@/services/book-player";

/** The book's speed, from the same choices as the phone; the desktop remembers its own. */
export function BookSpeedMenu(): React.JSX.Element {
  const speed = useBookSpeed();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-14 tabular-nums"
          aria-label={`Speed ${speed}×`}
          title="Speed"
        >
          {speed}×
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top">
        <DropdownMenuRadioGroup
          value={String(speed)}
          onValueChange={(value) => bookPlayer.setSpeed(Number(value))}
        >
          {BOOK_SPEEDS.map((option) => (
            <DropdownMenuRadioItem key={option} value={String(option)}>
              {option}×
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
