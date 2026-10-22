import type { UpdateMessage, UpdateQuestion } from "../../services/app-update";
import {
  DesktopFetchFailedError,
  DesktopStillFetchingError,
} from "../../services/desktop-fetch/createDesktopFetch";
import type { PlaybackFailure } from "../../services/playback-source/createPlaybackSource";
import { pairingRequiredText } from "./connectionText";
import type { MovieKind } from "../../../shared/mobile-sync-contract";

/** A message on the TV: a title and a short text, readable from the couch. */
export type TVMessageContent = {
  title: string;
  text: string;
  /** Whether trying again could help, so the screen offers a Retry. */
  canRetry: boolean;
};

/** What a TV message says, without the actions a screen adds. */
export type TVMessageText = Pick<TVMessageContent, "title" | "text">;

/** A yes/no on the TV: the message plus its two answers. */
export type TVQuestionContent = TVMessageText & {
  confirmLabel: string;
  cancelLabel: string;
};

export const desktopGettingVideoTitle = "The desktop is getting this Video";

const signInPattern = /sign.?in|not a bot|cookie|log.?in/i;

const pairingRequired: TVMessageContent = {
  title: "Pairing required",
  text: pairingRequiredText,
  canRetry: false,
};

/** Why a request to the desktop failed, without exception names or timeouts. */
export function describeDesktopRequestFailure(error: unknown) {
  if (error instanceof Error && error.name === "PairingRequiredError") {
    return pairingRequired;
  }
  return {
    title: "Couldn't reach the desktop",
    text: "Make sure LearnifyTube is open on the desktop with sync switched on, then try again.",
    canRetry: true,
  };
}

/** Why a Video couldn't start playing. Desktop-side problems say to fix them there. */
export function describeVideoFailure(error: unknown) {
  if (error instanceof DesktopStillFetchingError) {
    return {
      title: desktopGettingVideoTitle,
      text: "It's taking a while. Press Retry to keep waiting.",
      canRetry: true,
    };
  }
  if (error instanceof DesktopFetchFailedError) {
    if (signInPattern.test(error.desktopError ?? "")) {
      return {
        title: "YouTube wants the desktop to sign in",
        text: "Fix it on the desktop: open Settings → System → YouTube Authentication and choose a browser. Then press Retry.",
        canRetry: true,
      };
    }
    return {
      title: "The desktop couldn't get this Video",
      text: "Check its downloads and fix it on the desktop, then press Retry.",
      canRetry: true,
    };
  }
  return describeDesktopRequestFailure(error);
}

export const notOnThisTV: TVMessageContent = {
  title: "Not on this TV",
  text: "This Video isn't on this TV. Connect to the desktop to watch it.",
  canRetry: false,
};

export const collectionNotReady: TVMessageContent = {
  title: "Not ready yet",
  text: "The desktop couldn't open this list just now. Try again in a moment.",
  canRetry: false,
};

export const videoNotFound: TVMessageContent = {
  title: "Video not found",
  text: "Go back and pick another Video.",
  canRetry: false,
};

export const channelNotFound: TVMessageContent = {
  title: "Channel not found",
  text: "Go back and pick another channel.",
  canRetry: false,
};

export const storageFolderFailed: TVMessageContent = {
  title: "Couldn't use that folder",
  text: "Pick another folder, or keep Videos on the TV.",
  canRetry: false,
};

export const desktopGoneNextVideo: TVMessageContent = {
  title: "The desktop went away",
  text: "That Video isn't on this TV, so here's the next one that is.",
  canRetry: false,
};

export const desktopGoneNothingLeft: TVMessageContent = {
  title: "The desktop went away",
  text: "Nothing else here is on this TV.",
  canRetry: false,
};

export const desktopGoneMovie: TVMessageContent = {
  title: "The desktop went away",
  text: "This Movie isn't on this TV, so it stopped. It picks up where it left off next time.",
  canRetry: false,
};

export const seriesNotFound: TVMessageContent = {
  title: "Series not found",
  text: "The desktop doesn't show this Series any more. Go back and pick another one.",
  canRetry: false,
};

export const desktopGoneEpisode: TVMessageContent = {
  title: "The desktop went away",
  text: "This Episode isn't on this TV, so it stopped. It picks up where it left off next time.",
  canRetry: false,
};

/** Why a Movie isn't playing: the Playback source's failure, or the TV's player refusing the file. */
export type MovieProblem = PlaybackFailure | { kind: "playerRejected" };

/**
 * What the TV says when a Movie, or an Episode (`kind`), can't play. They are
 * files, so there's no fetch to wait for.
 */
export function describeMovieProblem(
  problem: MovieProblem,
  kind: MovieKind = "movie",
): TVMessageContent {
  const what = kind === "episode" ? "Episode" : "Movie";
  if (problem.kind === "playerRejected") {
    return {
      title: "Can't play this on this TV",
      text: `This TV can't play this ${what}'s file. Try it on the desktop, or convert the file to a format Android plays.`,
      canRetry: false,
    };
  }
  if (problem.kind === "notOnThisTV") {
    return {
      title: "Not on this TV",
      text: `This ${what} isn't on this TV. Connect to the desktop to watch it.`,
      canRetry: false,
    };
  }
  if (problem.kind === "videoNotFound") {
    return {
      title: `${what} not found`,
      text: `Go back and pick another ${what}.`,
      canRetry: false,
    };
  }
  return describeDesktopRequestFailure(problem.error);
}

const updatesUnavailable: TVMessageText = {
  title: "Updates aren't available",
  text: "This copy of LearnifyTube can't update itself.",
};

const updateMessages: Record<UpdateMessage["kind"], TVMessageText> = {
  unavailable: updatesUnavailable,
  notConfigured: updatesUnavailable,
  checkFailed: {
    title: "Couldn't check for updates",
    text: "Make sure the TV is online, then try again.",
  },
  cannotCompare: {
    title: "Couldn't check for updates",
    text: "Couldn't tell whether there's a newer version. Try again later.",
  },
  upToDate: {
    title: "You're up to date",
    text: "This TV has the latest version of LearnifyTube.",
  },
  downloading: {
    title: "Getting the update",
    text: "Keep LearnifyTube open. The installer opens when it's ready.",
  },
  installerOpened: {
    title: "Almost done",
    text: "Choose Install on the next screen to finish the update.",
  },
  failed: {
    title: "Couldn't install the update",
    text: "Try again from Settings in a moment.",
  },
};

/** What the update check tells the viewer, without error text or setup details. */
export function describeUpdateMessage(message: UpdateMessage) {
  return updateMessages[message.kind];
}

/** What the update check asks the viewer. */
export function describeUpdateQuestion(question: UpdateQuestion) {
  if (question.kind === "installBlocked") {
    return {
      title: "Couldn't start the update",
      text: "If it keeps happening, open Settings and turn on Install unknown apps for LearnifyTube.",
      confirmLabel: "Open Settings",
      cancelLabel: "Close",
    } satisfies TVQuestionContent;
  }
  return {
    title: "A new version is ready",
    text: question.versionLabel
      ? `Install LearnifyTube ${question.versionLabel} now?`
      : "Install the new version of LearnifyTube now?",
    confirmLabel: "Install",
    cancelLabel: "Later",
  } satisfies TVQuestionContent;
}
