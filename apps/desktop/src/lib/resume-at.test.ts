import { resumeAt } from "../../../shared/resume-at";

describe("resumeAt", () => {
  it("starts a file that was never played from the beginning", () => {
    expect(resumeAt({ positionSeconds: null, durationSeconds: 600 })).toBe(0);
    expect(resumeAt({ positionSeconds: 0, durationSeconds: 600 })).toBe(0);
  });

  it("resumes a file in progress where it stopped", () => {
    expect(resumeAt({ positionSeconds: 125, durationSeconds: 600 })).toBe(125);
  });

  it("starts a file played to about 90% from the beginning", () => {
    expect(resumeAt({ positionSeconds: 540, durationSeconds: 600 })).toBe(0);
    expect(resumeAt({ positionSeconds: 598, durationSeconds: 600 })).toBe(0);
  });

  it("resumes just short of 90%", () => {
    expect(resumeAt({ positionSeconds: 539, durationSeconds: 600 })).toBe(539);
  });

  it("starts a file marked watched from the beginning, wherever it stopped", () => {
    expect(resumeAt({ positionSeconds: 125, durationSeconds: 600, watched: true })).toBe(0);
  });

  it("resumes where it stopped when the length is unknown", () => {
    expect(resumeAt({ positionSeconds: 125, durationSeconds: null })).toBe(125);
    expect(resumeAt({ positionSeconds: 125, durationSeconds: 0 })).toBe(125);
  });
});
