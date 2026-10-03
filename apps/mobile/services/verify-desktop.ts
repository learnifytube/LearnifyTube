/**
 * EXPO_PUBLIC_VERIFY_DESKTOP_URL pins the app to one desktop (the `verify`
 * skill's own, isolated desktop), so a verify build never connects to the
 * user's: the Desktop connection tries only it, and the phone's connect
 * screens prefill it and skip discovery.
 */
export const verifyDesktopUrl =
  process.env.EXPO_PUBLIC_VERIFY_DESKTOP_URL || undefined;
