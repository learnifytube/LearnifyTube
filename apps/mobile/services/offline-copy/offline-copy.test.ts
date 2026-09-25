import { act, renderHook } from "@testing-library/react-native";
import {
  createOfflineCopy,
  type OfflineCopyPlatform,
  type StorageLocation,
} from "./createOfflineCopy";

const INTERNAL = { kind: "internal", directoryUri: null } as const;
const PICKED: StorageLocation = {
  kind: "saf",
  directoryUri: "content://picked",
};
const USB: StorageLocation = {
  kind: "file",
  directoryUri: "file:///storage/USB1/LearnifyTube/videos",
};

function basename(uri: string) {
  return uri.slice(uri.lastIndexOf("/") + 1);
}

function createFakePlatform({
  documentsDir = "file:///container-a/Documents",
  location = INTERNAL as StorageLocation,
  records = {} as Record<string, string>,
} = {}) {
  const files = new Set<string>();
  const contents = new Map<string, Uint8Array>();
  const unmounted = new Set<string>();
  const state = {
    documentsDir,
    location,
    records: { ...records },
    failCopies: false,
  };

  const isMounted = (uri: string) =>
    ![...unmounted].some((prefix) => uri.startsWith(prefix));

  const platform: OfflineCopyPlatform = {
    documentsDir: () => state.documentsDir,
    getStorageLocation: async () => state.location,
    loadRecords: () =>
      Object.entries(state.records).map(([videoId, uri]) => ({ videoId, uri })),
    writeRecord: (videoId, uri) => {
      state.records[videoId] = uri;
    },
    exists: async (uri) => isMounted(uri) && files.has(uri),
    list: async (dirUri) => {
      if (!isMounted(dirUri)) throw new Error(`Not mounted: ${dirUri}`);
      return [...files].filter(
        (uri) =>
          uri.startsWith(`${dirUri}/`) &&
          !uri.slice(dirUri.length + 1).includes("/"),
      );
    },
    ensureDir: async (parentUri, name) => {
      if (!isMounted(parentUri)) throw new Error(`Not mounted: ${parentUri}`);
      return `${parentUri}/${name}`;
    },
    createFile: async (dirUri, videoId) => {
      // Like Android's document provider, never overwrite: pick a new name.
      let uri = `${dirUri}/${videoId}.mp4`;
      for (let n = 1; files.has(uri); n++)
        uri = `${dirUri}/${videoId} (${n}).mp4`;
      files.add(uri);
      return uri;
    },
    copy: async (from, to) => {
      if (state.failCopies) throw new Error("Disk full");
      if (!files.has(from)) throw new Error(`Missing ${from}`);
      files.add(to);
      const bytes = contents.get(from);
      if (bytes) contents.set(to, bytes);
    },
    move: async (from, to) => {
      if (!files.has(from)) throw new Error(`Missing ${from}`);
      files.delete(from);
      files.add(to);
      const bytes = contents.get(from);
      if (bytes) {
        contents.set(to, bytes);
        contents.delete(from);
      }
    },
    remove: async (uri) => {
      files.delete(uri);
      contents.delete(uri);
    },
    readBytes: async (uri) => {
      if (!isMounted(uri) || !files.has(uri)) throw new Error(`Missing ${uri}`);
      return contents.get(uri) ?? new Uint8Array();
    },
  };

  return {
    platform,
    state,
    files,
    write: (uri: string, bytes?: Uint8Array) => {
      files.add(uri);
      if (bytes) contents.set(uri, bytes);
    },
    unmount: (prefix: string) => unmounted.add(prefix),
    remount: (prefix: string) => unmounted.delete(prefix),
  };
}

async function downloadInto(
  offlineCopy: ReturnType<typeof createOfflineCopy>,
  fake: ReturnType<typeof createFakePlatform>,
  videoId: string,
) {
  const tempUri = await offlineCopy.tempFileUri(videoId);
  fake.write(tempUri);
  await offlineCopy.adopt(videoId, tempUri);
  return tempUri;
}

describe("Offline copy", () => {
  it("finds an internal copy by Video ID after the app container path changes", async () => {
    const fake = createFakePlatform({
      documentsDir: "file:///container-b/Documents",
      records: { v1: "file:///container-a/Documents/videos/v1.mp4" },
    });
    fake.write("file:///container-b/Documents/videos/v1.mp4");
    const offlineCopy = createOfflineCopy(fake.platform);

    expect(offlineCopy.getUri("v1")).toBe(
      "file:///container-b/Documents/videos/v1.mp4",
    );

    await offlineCopy.scan();
    expect(offlineCopy.getUri("v1")).toBe(
      "file:///container-b/Documents/videos/v1.mp4",
    );
  });

  it("finds a picked-folder copy after a scan", async () => {
    const fake = createFakePlatform({ location: PICKED });
    fake.write("content://picked/videos/v2.mp4");
    const offlineCopy = createOfflineCopy(fake.platform);

    expect(offlineCopy.getUri("v2")).toBeNull();

    await offlineCopy.scan();
    expect(offlineCopy.getUri("v2")).toBe("content://picked/videos/v2.mp4");
    expect(fake.state.records.v2).toBe("content://picked/videos/v2.mp4");
  });

  it("places an adopted file in the USB folder", async () => {
    const fake = createFakePlatform({ location: USB });
    const offlineCopy = createOfflineCopy(fake.platform);

    const tempUri = await downloadInto(offlineCopy, fake, "v3");

    const expected = "file:///storage/USB1/LearnifyTube/videos/v3.mp4";
    expect(fake.files.has(expected)).toBe(true);
    expect(fake.files.has(tempUri)).toBe(false);
    expect(offlineCopy.getUri("v3")).toBe(expected);
    expect(fake.state.records.v3).toBe(expected);
  });

  it("places an adopted file in internal storage", async () => {
    const fake = createFakePlatform();
    const offlineCopy = createOfflineCopy(fake.platform);

    await downloadInto(offlineCopy, fake, "v3");

    expect(offlineCopy.getUri("v3")).toBe(
      "file:///container-a/Documents/videos/v3.mp4",
    );
    expect([...fake.files]).toEqual([
      "file:///container-a/Documents/videos/v3.mp4",
    ]);
  });

  it("replaces an existing copy in the same Storage location", async () => {
    const fake = createFakePlatform({ location: PICKED });
    fake.write("content://picked/videos/v4.mp4");
    const offlineCopy = createOfflineCopy(fake.platform);
    await offlineCopy.scan();

    await downloadInto(offlineCopy, fake, "v4");

    const [only, ...others] = fake.files;
    expect(others).toEqual([]);
    expect(offlineCopy.getUri("v4")).toBe(only);

    await offlineCopy.scan();
    expect(createOfflineCopy(fake.platform).getUri("v4")).toBe(only);
  });

  it("replaces an existing copy in the same USB folder", async () => {
    const usbCopy = "file:///storage/USB1/LearnifyTube/videos/v4.mp4";
    const fake = createFakePlatform({
      location: USB,
      records: { v4: usbCopy },
    });
    fake.write(usbCopy);
    const offlineCopy = createOfflineCopy(fake.platform);

    await downloadInto(offlineCopy, fake, "v4");

    expect([...fake.files]).toEqual([usbCopy]);
    expect(offlineCopy.getUri("v4")).toBe(usbCopy);
  });

  it("replaces an existing copy in another Storage location", async () => {
    const fake = createFakePlatform({
      location: PICKED,
      records: { v4: "file:///container-a/Documents/videos/v4.mp4" },
    });
    fake.write("file:///container-a/Documents/videos/v4.mp4");
    const offlineCopy = createOfflineCopy(fake.platform);

    await downloadInto(offlineCopy, fake, "v4");

    expect([...fake.files]).toEqual(["content://picked/videos/v4.mp4"]);
    expect(offlineCopy.getUri("v4")).toBe("content://picked/videos/v4.mp4");
    expect(fake.state.records.v4).toBe("content://picked/videos/v4.mp4");
  });

  it("cleans up a partial temp file when a Download fails or is cancelled", async () => {
    const fake = createFakePlatform();
    const offlineCopy = createOfflineCopy(fake.platform);

    const tempUri = await offlineCopy.tempFileUri("v5");
    fake.write(tempUri);
    await offlineCopy.discardTemp("v5");

    expect(fake.files.size).toBe(0);
    expect(offlineCopy.getUri("v5")).toBeNull();
  });

  it("cleans up the temp file and keeps the old copy when adopt fails", async () => {
    const fake = createFakePlatform({
      location: USB,
      records: { v5: "file:///container-a/Documents/videos/v5.mp4" },
    });
    fake.write("file:///container-a/Documents/videos/v5.mp4");
    const offlineCopy = createOfflineCopy(fake.platform);
    fake.state.failCopies = true;

    const tempUri = await offlineCopy.tempFileUri("v5");
    fake.write(tempUri);
    await expect(offlineCopy.adopt("v5", tempUri)).rejects.toThrow("Disk full");

    expect([...fake.files]).toEqual([
      "file:///container-a/Documents/videos/v5.mp4",
    ]);
    expect(offlineCopy.getUri("v5")).toBe(
      "file:///container-a/Documents/videos/v5.mp4",
    );
  });

  it("keeps the old copy in the same picked folder when adopt fails", async () => {
    const pickedCopy = "content://picked/videos/v5.mp4";
    const fake = createFakePlatform({
      location: PICKED,
      records: { v5: pickedCopy },
    });
    fake.write(pickedCopy);
    const offlineCopy = createOfflineCopy(fake.platform);
    fake.state.failCopies = true;

    const tempUri = await offlineCopy.tempFileUri("v5");
    fake.write(tempUri);
    await expect(offlineCopy.adopt("v5", tempUri)).rejects.toThrow("Disk full");

    expect([...fake.files]).toEqual([pickedCopy]);
    expect(offlineCopy.getUri("v5")).toBe(pickedCopy);
  });

  it("keeps an adopted copy when an overlapping scan finishes after it", async () => {
    const oldCopy = "content://picked/videos/v11.mp4";
    const fake = createFakePlatform({ records: { v11: oldCopy } });
    fake.write(oldCopy);
    const offlineCopy = createOfflineCopy(fake.platform);
    const gate = () => {
      let open = () => {};
      const opened = new Promise<void>((resolve) => (open = resolve));
      return { open, opened };
    };
    const moveGate = gate();
    const existsGate = gate();
    const { move, exists } = fake.platform;
    fake.platform.move = async (from, to) => {
      await moveGate.opened;
      return move(from, to);
    };
    fake.platform.exists = async (uri) => {
      const found = await exists(uri);
      await existsGate.opened;
      return found;
    };

    // Adopt starts, then a scan sees the old copy before the new one lands.
    const tempUri = await offlineCopy.tempFileUri("v11");
    fake.write(tempUri);
    const adopting = offlineCopy.adopt("v11", tempUri);
    const scanning = offlineCopy.scan();
    await new Promise((resolve) => setTimeout(resolve, 0));
    moveGate.open();
    await adopting;
    existsGate.open();
    await scanning;

    const newCopy = "file:///container-a/Documents/videos/v11.mp4";
    expect(offlineCopy.getUri("v11")).toBe(newCopy);
    expect(fake.state.records.v11).toBe(newCopy);
  });

  it("returns null for an unreachable copy, keeps its record, and finds it again after a scan", async () => {
    const usbCopy = "file:///storage/USB1/LearnifyTube/videos/v6.mp4";
    const fake = createFakePlatform({
      location: USB,
      records: { v6: usbCopy },
    });
    fake.write(usbCopy);
    const offlineCopy = createOfflineCopy(fake.platform);

    fake.unmount("file:///storage/USB1");
    await offlineCopy.scan();
    expect(offlineCopy.getUri("v6")).toBeNull();
    expect(fake.state.records.v6).toBe(usbCopy);

    fake.remount("file:///storage/USB1");
    await offlineCopy.scan();
    expect(offlineCopy.getUri("v6")).toBe(usbCopy);
  });

  it("keeps a copy made before a Storage location change findable", async () => {
    const fake = createFakePlatform({ location: PICKED });
    const offlineCopy = createOfflineCopy(fake.platform);
    await downloadInto(offlineCopy, fake, "v7");

    fake.state.location = USB;
    await offlineCopy.scan();

    expect(offlineCopy.getUri("v7")).toBe("content://picked/videos/v7.mp4");
    expect(createOfflineCopy(fake.platform).getUri("v7")).toBe(
      "content://picked/videos/v7.mp4",
    );
  });

  it("re-renders the hook when adopt completes", async () => {
    const fake = createFakePlatform();
    const offlineCopy = createOfflineCopy(fake.platform);
    const { result } = await renderHook(() => offlineCopy.useUri("v8"));

    expect(result.current).toBeNull();

    await act(async () => {
      await downloadInto(offlineCopy, fake, "v8");
    });
    expect(result.current).toBe("file:///container-a/Documents/videos/v8.mp4");
  });

  it("re-renders the lookup hook when a USB drive is unplugged and plugged back in", async () => {
    const usbCopy = "file:///storage/USB1/LearnifyTube/videos/v12.mp4";
    const fake = createFakePlatform({
      location: USB,
      records: { v12: usbCopy },
    });
    fake.write(usbCopy);
    const offlineCopy = createOfflineCopy(fake.platform);
    const { result } = await renderHook(() => offlineCopy.useLookup());

    expect(result.current("v12")).toBe(usbCopy);

    fake.unmount("file:///storage/USB1");
    await act(async () => {
      await offlineCopy.scan();
    });
    expect(result.current("v12")).toBeNull();

    fake.remount("file:///storage/USB1");
    await act(async () => {
      await offlineCopy.scan();
    });
    expect(result.current("v12")).toBe(usbCopy);
  });

  it("answers from saved records before the first scan", () => {
    const fake = createFakePlatform({
      location: PICKED,
      records: {
        v9: "content://picked/videos/v9.mp4",
        v10: "file:///storage/USB1/LearnifyTube/videos/v10.mp4",
      },
    });
    const offlineCopy = createOfflineCopy(fake.platform);

    expect(offlineCopy.getUri("v9")).toBe("content://picked/videos/v9.mp4");
    expect(offlineCopy.getUri("v10")).toBe(
      "file:///storage/USB1/LearnifyTube/videos/v10.mp4",
    );
    expect(offlineCopy.getUri("unknown")).toBeNull();
  });

  it("reads bytes of a reachable Offline copy for peer-to-peer serving", async () => {
    const fake = createFakePlatform({ location: PICKED });
    const bytes = new Uint8Array([1, 2, 3, 4]);
    fake.write("content://picked/videos/v13.mp4", bytes);
    fake.state.records.v13 = "content://picked/videos/v13.mp4";
    const offlineCopy = createOfflineCopy(fake.platform);
    await offlineCopy.scan();

    expect(await offlineCopy.readBytes("v13")).toEqual(bytes);
    expect(await offlineCopy.readBytes("missing")).toBeNull();
  });
});
