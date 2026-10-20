import React, { useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import BaseLayout from "@/layouts/BaseLayout";
import { Outlet, createRootRoute, useMatches } from "@tanstack/react-router";
import { analytics } from "@/helpers/analytics";
import { logger } from "@/helpers/logger";
import { Toaster } from "sonner";
import { useBookPlayerState } from "@/services/book-player";
import { BOOK_PLAYER_BAR_TOAST_OFFSET } from "@/components/book-player/BookPlayerBar";

export const RootRoute = createRootRoute({
  component: Root,
  beforeLoad: ({ location }) => {
    // Track page view using the safer analytics helper
    analytics.pageView(location.pathname, {
      params: location.search ? Object.fromEntries(new URLSearchParams(location.search)) : {},
    });

    // Navigation trace: log beforeLoad for every route transition
    try {
      const searchParams = location.search
        ? Object.fromEntries(new URLSearchParams(location.search))
        : {};
      logger.debug("[Navigation] beforeLoad", {
        path: location.pathname,
        search: searchParams,
      });
    } catch (e) {
      // Ensure logging never breaks navigation
      logger.error("Failed to log beforeLoad navigation params", e);
    }
  },
  errorComponent: function ErrorComponent({ error }) {
    const { toast } = useToast();
    const err = error instanceof Error ? error : new Error(String(error));

    useEffect(() => {
      logger.error("[ErrorComponent] Navigation error", err);

      // Track error events using the safer analytics helper
      analytics.track("navigation_error", {
        error_message: err.message,
        path: window.location.pathname,
      });

      toast({
        variant: "destructive",
        title: "Error",
        description: err.message,
      });
    }, [err, toast]);

    return <Root />;
  },
});

function Root(): React.JSX.Element {
  const matches = useMatches();
  const isFullScreenRoute = matches.some((match) => match.pathname === "/raining-letters");
  const bookPlayerState = useBookPlayerState();
  // Toasts rise above the Book player bar while it shows, clear of its controls.
  const bookPlayerBarShown = !isFullScreenRoute && bookPlayerState.status !== "idle";
  const previousPathRef = useRef<string | null>(null);

  // Navigation trace: log every route change with from -> to
  useEffect(() => {
    const leaf = matches[matches.length - 1];
    const pathname = leaf?.pathname ?? window.location.pathname;
    const search = Object.fromEntries(new URLSearchParams(window.location.search));

    // Attempt to read params from the leaf match if present
    // TanStack Router match objects have params, but type isn't exposed at this level
    const params: Record<string, unknown> =
      leaf &&
      typeof leaf === "object" &&
      "params" in leaf &&
      typeof leaf.params === "object" &&
      leaf.params !== null
        ? (leaf.params as Record<string, unknown>)
        : {};

    const from = previousPathRef.current;
    previousPathRef.current = pathname;

    logger.debug("[Navigation] navigated", {
      from: from ?? "(initial)",
      to: pathname,
      params: Object.keys(params).length ? params : undefined,
      search: Object.keys(search).length ? search : undefined,
    });
  }, [matches]);

  return (
    <>
      {isFullScreenRoute ? (
        <Outlet />
      ) : (
        <BaseLayout>
          <Outlet />
        </BaseLayout>
      )}
      <Toaster offset={bookPlayerBarShown ? { bottom: BOOK_PLAYER_BAR_TOAST_OFFSET } : undefined} />
    </>
  );
}
