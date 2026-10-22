import type { FolderListing } from "@/api/audiobooks/import-plan";
import { classifyFolder, planMovieImport } from "./import-plan";

const files = (...paths: string[]): FolderListing["files"] => paths.map((path) => ({ path }));

describe("classifyFolder", () => {
  it("makes a folder of audio files an Audiobooks folder", () => {
    expect(classifyFolder({ name: "book", files: files("1.mp3", "2.m4b", "cover.jpg") })).toEqual({
      kind: "audiobooks",
      audioFiles: 2,
      videoFiles: 0,
      mixed: false,
    });
  });

  it("makes a folder of video files a Movies folder", () => {
    expect(
      classifyFolder({ name: "films", files: files("a.mkv", "b/b.mp4", "c.avi", "poster.jpg") })
    ).toEqual({ kind: "movies", audioFiles: 0, videoFiles: 3, mixed: false });
  });

  it("flags a folder that mixes audio and video, and goes by whichever has more files", () => {
    expect(
      classifyFolder({ name: "film", files: files("film.mkv", "extras.mp4", "theme.mp3") })
    ).toEqual({ kind: "movies", audioFiles: 1, videoFiles: 2, mixed: true });
    expect(classifyFolder({ name: "book", files: files("1.mp3", "2.mp3", "trailer.mp4") })).toEqual(
      { kind: "audiobooks", audioFiles: 2, videoFiles: 1, mixed: true }
    );
  });

  it("finds nothing to import in a folder without audio or video", () => {
    expect(classifyFolder({ name: "photos", files: files("a.jpg", "notes.txt") }).kind).toBeNull();
  });
});

const matrix: FolderListing = {
  name: "The.Matrix.1999.1080p",
  files: [
    { path: "poster.jpg" },
    {
      path: "The.Matrix.1999.1080p.mkv",
      durationSeconds: 8160,
      videoCodec: "h264",
      audioCodec: "aac",
    },
    { path: "Sample/sample.mkv", durationSeconds: 60 },
    { path: "The.Matrix.1999.1080p.nfo" },
  ],
};

const films: FolderListing = {
  name: "Films",
  files: [
    { path: "Up (2009).mp4", durationSeconds: 5760 },
    { path: "Alien (1979)/Alien.1979.mkv", durationSeconds: 7020 },
    { path: "Alien (1979)/folder.jpg" },
    { path: "Shorts/Short 10.mp4" },
    { path: "Shorts/Short 2.mp4" },
    { path: "Shorts/poster.jpg" },
    { path: "Up (2009).jpg" },
  ],
};

describe("planMovieImport", () => {
  it("makes a film's folder one Movie named after the folder, leaving out samples", () => {
    const plan = planMovieImport(matrix);
    expect(plan.suggestedLayout).toBe("one-movie");
    expect(plan.movies).toEqual([
      {
        path: "The.Matrix.1999.1080p.mkv",
        title: "The.Matrix.1999.1080p",
        poster: { kind: "file", path: "poster.jpg" },
        durationSeconds: 8160,
        videoCodec: "h264",
        audioCodec: "aac",
        codecWarnings: [],
      },
    ]);
  });

  it("makes each file of a collection one Movie, named after its own folder when it has one", () => {
    const plan = planMovieImport(films);
    expect(plan.suggestedLayout).toBe("movie-per-file");
    expect(plan.movies.map((movie) => [movie.path, movie.title])).toEqual([
      ["Alien (1979)/Alien.1979.mkv", "Alien (1979)"],
      ["Shorts/Short 2.mp4", "Short 2"],
      ["Shorts/Short 10.mp4", "Short 10"],
      ["Up (2009).mp4", "Up (2009)"],
    ]);
  });

  it("takes each Movie's poster from its own folder, or from an image named after the file", () => {
    const posters = Object.fromEntries(
      planMovieImport(films, "movie-per-file").movies.map((movie) => [movie.title, movie.poster])
    );
    expect(posters["Alien (1979)"]).toEqual({ kind: "file", path: "Alien (1979)/folder.jpg" });
    expect(posters["Up (2009)"]).toEqual({ kind: "file", path: "Up (2009).jpg" });
    // Shorts/poster.jpg belongs to no one short in particular.
    expect(posters["Short 2"]).toEqual({ kind: "frame", videoPath: "Shorts/Short 2.mp4" });
  });

  it("falls back to the file's embedded art, then a frame of the video", () => {
    const [withArt, withoutArt] = planMovieImport(
      { name: "Films", files: [{ path: "a.mkv", attachedPicStream: 2 }, { path: "b.mp4" }] },
      "movie-per-file"
    ).movies;
    expect(withArt.poster).toEqual({ kind: "embedded", videoPath: "a.mkv", stream: 2 });
    expect(withoutArt.poster).toEqual({ kind: "frame", videoPath: "b.mp4" });
  });

  it("lets the user flip a film's folder into one Movie per file, and a collection into one", () => {
    expect(planMovieImport(matrix, "movie-per-file").movies.map((movie) => movie.title)).toEqual([
      "Sample",
      "The.Matrix.1999.1080p",
    ]);
    const [one, ...rest] = planMovieImport(films, "one-movie").movies;
    expect(rest).toEqual([]);
    // The longest file is the film.
    expect(one).toMatchObject({ title: "Films", path: "Alien (1979)/Alien.1979.mkv" });
  });

  it("leaves out files that are not video, and proposes nothing without video", () => {
    const plan = planMovieImport(
      { name: "x", files: [{ path: "theme.mp3" }, { path: "film.webm" }] },
      "movie-per-file"
    );
    expect(plan.movies.map((movie) => movie.path)).toEqual(["film.webm"]);
    expect(planMovieImport({ name: "book", files: [{ path: "1.mp3" }] }).movies).toEqual([]);
  });

  it("warns about files Android is likely to refuse: AVI and WMV files, DTS and TrueHD audio", () => {
    const warnings = Object.fromEntries(
      planMovieImport({
        name: "Films",
        files: [
          { path: "Old.avi", videoCodec: "mpeg4", audioCodec: "mp3" },
          { path: "Concert.mkv", videoCodec: "h264", audioCodec: "dts" },
          { path: "Blu-ray.mkv", videoCodec: "hevc", audioCodec: "truehd" },
          { path: "Home.wmv", videoCodec: "wmv3", audioCodec: "wmav2" },
          { path: "Fine.mp4", videoCodec: "h264", audioCodec: "aac" },
          { path: "Unprobed.mkv" },
        ],
      }).movies.map((movie) => [movie.path, movie.codecWarnings])
    );
    expect(warnings).toEqual({
      "Old.avi": [{ part: "container", name: "AVI" }],
      "Concert.mkv": [{ part: "audio", name: "DTS" }],
      "Blu-ray.mkv": [{ part: "audio", name: "Dolby TrueHD" }],
      "Home.wmv": [
        { part: "container", name: "WMV" },
        { part: "video", name: "WMV" },
        { part: "audio", name: "WMA" },
      ],
      "Fine.mp4": [],
      "Unprobed.mkv": [],
    });
  });
});
