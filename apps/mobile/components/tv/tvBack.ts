import { useEffect, useRef } from "react";
import { BackHandler } from "react-native";
import { router, useIsFocused, usePathname, type Href } from "expo-router";

/**
 * The TV's hardware Back fallback, mounted by the TV route group's layout: Back pops
 * the stack, lands on the TV home screen when there is nothing to pop (a deep link),
 * and exits the app from the home screen.
 */
export function useTVBackNavigation() {
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (router.canGoBack()) {
          router.back();
          return true;
        }

        if (pathnameRef.current !== "/") {
          router.replace("/(tv)" as Href);
          return true;
        }

        return false;
      },
    );
    return () => subscription.remove();
  }, []);
}

/**
 * Lets a TV screen handle Back first while it is the focused screen. Return true
 * when Back was handled; false leaves it to the stack.
 */
export function useTVBackInterceptor(onBack: () => boolean) {
  const isFocused = useIsFocused();
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  // Back listeners run newest first. A screen pushed on top adds its listener after
  // the layout's and the navigator's, so it is asked before either pops the stack.
  // On the home screen nothing can pop, so the order there doesn't matter.
  useEffect(() => {
    if (!isFocused) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () =>
      onBackRef.current(),
    );
    return () => subscription.remove();
  }, [isFocused]);
}
