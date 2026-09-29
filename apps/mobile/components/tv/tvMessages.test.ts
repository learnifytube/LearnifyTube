import {
  DesktopFetchFailedError,
  DesktopStillFetchingError,
  describeDesktopRequestFailure,
  describeVideoFailure,
  type TVMessageContent,
} from "./tvMessages";

const shown = (message: TVMessageContent) => `${message.title} ${message.text}`;

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
