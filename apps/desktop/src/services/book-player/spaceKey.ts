import type { DesktopBookPlayer } from "./desktopBookPlayer";

/** The parts of a `keydown` event the Space key needs. */
export type BookPlayerKeyEvent = Pick<
  KeyboardEvent,
  "key" | "repeat" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "defaultPrevented"
> & {
  target: EventTarget | FocusedElement | null;
  preventDefault: () => void;
};

type FocusedElement = Pick<HTMLElement, "tagName" | "isContentEditable" | "getAttribute">;

// Where Space types a space or presses the focused control.
const SPACE_TAKERS = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON"]);
const SPACE_TAKING_ROLES = new Set(["button", "slider", "checkbox", "switch", "textbox", "option"]);

const takesSpace = (target: BookPlayerKeyEvent["target"]): boolean =>
  target !== null &&
  "tagName" in target &&
  (target.isContentEditable ||
    SPACE_TAKERS.has(target.tagName) ||
    SPACE_TAKING_ROLES.has(target.getAttribute("role") ?? ""));

/**
 * Space plays and pauses the book in the Book player, unless focus is in a text
 * field or on a control, or a Video player on the page has Space for itself.
 */
export function handleBookPlayerKey(
  event: BookPlayerKeyEvent,
  player: Pick<DesktopBookPlayer, "getState" | "pause" | "resume">,
  { videoOnPage = false }: { videoOnPage?: boolean } = {}
): void {
  if (event.key !== " " || event.repeat || event.defaultPrevented || videoOnPage) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (takesSpace(event.target)) return;
  const { status } = player.getState();
  if (status === "playing") player.pause();
  else if (status === "paused") player.resume();
  else return;
  event.preventDefault();
}
