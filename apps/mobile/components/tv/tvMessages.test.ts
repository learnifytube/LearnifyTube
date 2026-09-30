import {
  DesktopFetchFailedError,
  DesktopStillFetchingError,
} from "../../services/desktop-fetch/createDesktopFetch";
import {
  describeDesktopRequestFailure,
  describeUpdateMessage,
  describeUpdateQuestion,
  describeVideoFailure,
  type TVMessageText,
} from "./tvMessages";

const shown = (message: TVMessageText) => `${message.title} ${message.text}`;

describe("describeVideoFailure", () => {
  it("names the desktop as the place to fix a YouTube sign-in failure", () => {
    const message = describeVideoFailure(
      new DesktopFetchFailedError(
        "ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication.",
      ),
    );

    expect(shown(message)).toMatch(/desktop/i);
    expect(shown(message)).toMatch(/sign in/i);
    expect(shown(message)).not.toMatch(/ERROR|--cookies|\[youtube\]/);
    expect(message.canRetry).toBe(true);
  });

  it("treats a cookies failure as a desktop sign-in problem", () => {
    const message = describeVideoFailure(
      new DesktopFetchFailedError("Could not copy Chrome cookie database"),
    );

    expect(message).toEqual(
      describeVideoFailure(new DesktopFetchFailedError("Sign in required")),
    );
  });

  it("says any other failed fetch must be fixed on the desktop", () => {
    const message = describeVideoFailure(
      new DesktopFetchFailedError("HTTP Error 403: Forbidden"),
    );

    expect(shown(message)).toMatch(/fix it on the desktop/i);
    expect(shown(message)).not.toMatch(/403|Forbidden/);
    expect(message.canRetry).toBe(true);
  });

  it("says the desktop is still getting a Video that takes long", () => {
    const message = describeVideoFailure(new DesktopStillFetchingError());

    expect(message.title).toBe("The desktop is getting this Video");
    expect(message.canRetry).toBe(true);
  });

  it("hides timeouts and exception names behind the desktop's reachability", () => {
    for (const error of [
      new Error("Request timed out after 15000ms"),
      new TypeError("Network request failed"),
      "something odd",
    ]) {
      const message = describeVideoFailure(error);

      expect(message.title).toBe("Couldn't reach the desktop");
      expect(shown(message)).not.toMatch(/TypeError|timed out after|\d/);
      expect(message.canRetry).toBe(true);
    }
  });

  it("sends a pairing failure to the pairing code", () => {
    const message = describeVideoFailure(
      Object.assign(new Error("401"), { name: "PairingRequiredError" }),
    );

    expect(message.title).toBe("Pairing required");
    expect(shown(message)).toMatch(/pairing code/);
  });
});

describe("describeDesktopRequestFailure", () => {
  it("never shows the raw error", () => {
    const message = describeDesktopRequestFailure(
      new TypeError("Network request failed"),
    );

    expect(shown(message)).not.toMatch(/TypeError|Network request failed/);
    expect(shown(message)).toMatch(/desktop/);
  });
});

describe("describeUpdateMessage", () => {
  it("never shows the raw error when a check or install fails", () => {
    const error = new Error("GitHub latest release request failed (HTTP 403).");

    for (const message of [
      describeUpdateMessage({ kind: "checkFailed", error }),
      describeUpdateMessage({ kind: "failed", error }),
    ]) {
      expect(shown(message)).not.toMatch(/GitHub|HTTP|403/);
    }
  });

  it("keeps developer setup out of the unavailable messages", () => {
    for (const message of [
      describeUpdateMessage({
        kind: "unavailable",
        reason: "APK self-update is unavailable in development builds.",
      }),
      describeUpdateMessage({ kind: "notConfigured" }),
      describeUpdateMessage({ kind: "cannotCompare" }),
    ]) {
      expect(shown(message)).not.toMatch(/APK|app\.json|expo|metadata/i);
    }
  });

  it("tells the viewer the TV is up to date", () => {
    expect(describeUpdateMessage({ kind: "upToDate" }).title).toMatch(
      /up to date/i,
    );
  });
});

describe("describeUpdateQuestion", () => {
  it("offers Install and Later for an available update, naming the version", () => {
    const question = describeUpdateQuestion({
      kind: "updateAvailable",
      versionLabel: "1.4.0",
      summaryLines: ["Current build: 12", "Latest build: 14"],
      releaseNotes: "## What's new\n- versionCode: 14",
    });

    expect(question.confirmLabel).toBe("Install");
    expect(question.cancelLabel).toBe("Later");
    expect(shown(question)).toMatch(/1\.4\.0/);
    expect(shown(question)).not.toMatch(/build|versionCode|##/);
  });

  it("asks to allow installs from Settings when the installer is blocked", () => {
    const question = describeUpdateQuestion({ kind: "installBlocked" });

    expect(question.confirmLabel).toBe("Open Settings");
    expect(shown(question)).toMatch(/LearnifyTube/);
  });
});
