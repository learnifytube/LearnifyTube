import { logger } from "@/helpers/logger";

const SIX_HOURS = 6 * 60 * 60 * 1000;

type AutoKeepScheduler = { runNow: () => Promise<void>; start: () => void };

// Runs Auto-keep checks at start and then on an interval while the app runs, never two at once.
export const createAutoKeepScheduler = (
  run: () => Promise<void>,
  intervalMs = SIX_HOURS
): AutoKeepScheduler => {
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const runNow = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await run();
    } catch (error) {
      logger.error("[auto-keep] Checks failed", error);
    } finally {
      running = false;
    }
  };

  return {
    runNow,
    start: () => {
      if (timer) return;
      void runNow();
      timer = setInterval(() => void runNow(), intervalMs);
    },
  };
};
