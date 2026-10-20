import { createSseParser } from "./createSseParser";

const parse = (...chunks: string[]) => {
  const events: string[] = [];
  const parser = createSseParser((event) => events.push(event));
  for (const chunk of chunks) parser.push(chunk);
  return events;
};

describe("createSseParser", () => {
  it("reads named events", () => {
    expect(
      parse(
        "event: sync:on-device-set\ndata: {}\n\nevent: sync:audiobooks\ndata: {}\n\n",
      ),
    ).toEqual(["sync:on-device-set", "sync:audiobooks"]);
  });

  it("reads an event split across chunks", () => {
    expect(parse("eve", "nt: sync:audio", "books\ndata: {}\n", "\n")).toEqual([
      "sync:audiobooks",
    ]);
  });

  it("ignores comments, and calls an unnamed event message", () => {
    expect(parse(": connected\n\ndata: {}\n\n")).toEqual(["message"]);
  });

  it("accepts CRLF line endings", () => {
    expect(parse("event: sync:audiobooks\r\ndata: {}\r\n\r\n")).toEqual([
      "sync:audiobooks",
    ]);
  });

  it("accepts a CRLF split between chunks", () => {
    expect(
      parse("event: sync:audiobooks\r", "\ndata: {}\r", "\n\r", "\n"),
    ).toEqual(["sync:audiobooks"]);
  });

  it("waits for the blank line before dispatching", () => {
    expect(parse("event: sync:audiobooks\ndata: {}\n")).toEqual([]);
  });
});
