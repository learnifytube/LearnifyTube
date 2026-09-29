import { getAppSurface } from "../core/hooks/useAppSurface";

const SCHEME = "learnify://";

// Screens like /player/:id and /connect exist in both route groups, so a deep link on
// the TV could open the phone screen. Send it into the TV group instead.
export function redirectSystemPath({ path }: { path: string }) {
  if (getAppSurface() !== "tv" || !path.startsWith(SCHEME)) return path;

  const route = path.slice(SCHEME.length).replace(/^\/+/, "");
  if (route.startsWith("(tv)")) return path;
  return `/(tv)/${route}`;
}
