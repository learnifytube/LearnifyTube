import { Readable } from "stream";
import type { IncomingMessage } from "http";
import { readRequestBody, type StuckBody } from "./sync-request-body";

const STUCK_AFTER_MS = 20;

const fakeRequest = (contentLength: number) => {
  const stream = new Readable({ read() {} });
  return Object.assign(stream, {
    headers: { "content-length": String(contentLength) },
    complete: false,
  }) as unknown as IncomingMessage & Readable;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("readRequestBody", () => {
  test("reports once when the whole body is in but the request never ends", async () => {
    const req = fakeRequest(2);
    const reports: StuckBody[] = [];
    const body = readRequestBody(req, (stuck) => reports.push(stuck), STUCK_AFTER_MS);

    req.push("{}");
    await wait(STUCK_AFTER_MS * 4);

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ expectedBytes: 2, receivedBytes: 2 });

    req.push(null);
    await expect(body).resolves.toBe("{}");
  });

  test("does not report a request that ends", async () => {
    const req = fakeRequest(2);
    const onStuck = jest.fn();
    const body = readRequestBody(req, onStuck, STUCK_AFTER_MS);

    req.push("{}");
    req.push(null);
    await expect(body).resolves.toBe("{}");
    await wait(STUCK_AFTER_MS * 4);

    expect(onStuck).not.toHaveBeenCalled();
  });

  test("does not report a body that is still arriving", async () => {
    const req = fakeRequest(10);
    const onStuck = jest.fn();
    const body = readRequestBody(req, onStuck, STUCK_AFTER_MS);

    req.push('{"a":');
    await wait(STUCK_AFTER_MS * 4);
    expect(onStuck).not.toHaveBeenCalled();

    req.push("1}");
    req.push(null);
    await expect(body).resolves.toBe('{"a":1}');
  });

  test("keeps a character split across chunks whole", async () => {
    const bytes = Buffer.from('{"t":"é"}');
    const req = fakeRequest(bytes.length);
    const body = readRequestBody(req, jest.fn(), STUCK_AFTER_MS);

    const split = bytes.indexOf(0xc3) + 1;
    req.push(bytes.subarray(0, split));
    req.push(bytes.subarray(split));
    req.push(null);

    await expect(body).resolves.toBe('{"t":"é"}');
  });
});
