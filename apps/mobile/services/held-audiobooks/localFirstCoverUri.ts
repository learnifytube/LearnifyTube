import { resolveRemoteAssetUrl } from "../remoteAssetUrl";

/**
 * Where to show a book's cover from: the copy stored on the phone with its
 * Tracks when there is one, else the desktop's while it is connected, else none.
 */
export const localFirstCoverUri = ({
  heldCoverUri,
  serverUrl,
  coverUrl,
}: {
  heldCoverUri: string | null;
  serverUrl: string | null;
  coverUrl: string | null;
}) =>
  heldCoverUri ??
  (serverUrl ? resolveRemoteAssetUrl(serverUrl, coverUrl) : null);
