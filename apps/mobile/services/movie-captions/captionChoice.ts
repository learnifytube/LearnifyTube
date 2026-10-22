import type { Caption } from "../../../shared/mobile-sync-contract";

const baseLanguage = (language: string | null) =>
  language?.split("-")[0].toLowerCase() ?? null;

/**
 * The Caption one press of the Captions button turns on: Off goes to the
 * viewer's language (`preferredLanguage`, e.g. "fr") when a Caption has it,
 * else the first one; each press after goes to the next language, and the
 * last goes back to Off. With one Caption it is an on/off toggle.
 */
export function nextCaption(
  captions: Caption[],
  currentId: string | null,
  preferredLanguage: string | null,
): Caption | null {
  const preferred = baseLanguage(preferredLanguage);
  const order = preferred
    ? [
        ...captions.filter((c) => baseLanguage(c.language) === preferred),
        ...captions.filter((c) => baseLanguage(c.language) !== preferred),
      ]
    : captions;
  if (currentId === null) return order[0] ?? null;
  const index = order.findIndex((caption) => caption.id === currentId);
  if (index < 0) return order[0] ?? null;
  return order[index + 1] ?? null;
}
