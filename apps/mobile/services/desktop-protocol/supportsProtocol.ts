/** Whether a desktop speaks `minVersion`; an unknown version (null) does not. */
export const supportsProtocol = (version: number | null, minVersion: number) =>
  version !== null && version >= minVersion;
