import { authorizeSyncRequest, generatePairingCode, normalizePairingCode } from "./sync-auth";

const CODE = "ABCD2345";

describe("authorizeSyncRequest", () => {
  test("allows a request carrying the pairing code as a bearer token", () => {
    const result = authorizeSyncRequest(
      { url: "/api/videos", headers: { authorization: `Bearer ${CODE}` } },
      CODE
    );
    expect(result).toEqual({ ok: true, url: "/api/videos" });
  });

  test("allows a request carrying the pairing code as a token query param and strips it", () => {
    const result = authorizeSyncRequest(
      { url: `/api/video/abc/thumbnail?token=${CODE}`, headers: {} },
      CODE
    );
    expect(result).toEqual({ ok: true, url: "/api/video/abc/thumbnail" });
  });

  test("keeps other query params when stripping the token", () => {
    const result = authorizeSyncRequest(
      { url: `/api/flashcards?due=true&token=${CODE}&limit=5`, headers: {} },
      CODE
    );
    expect(result).toEqual({ ok: true, url: "/api/flashcards?due=true&limit=5" });
  });

  test("accepts the code in the display form a person types (lowercase, dash)", () => {
    const result = authorizeSyncRequest(
      { url: "/api/info", headers: { authorization: "Bearer abcd-2345" } },
      CODE
    );
    expect(result.ok).toBe(true);
  });

  test("rejects a request with no credentials with 401", () => {
    const result = authorizeSyncRequest({ url: "/api/info", headers: {} }, CODE);
    expect(result).toEqual({ ok: false, status: 401 });
  });

  test("rejects a wrong code with 401", () => {
    const result = authorizeSyncRequest(
      { url: "/api/info", headers: { authorization: "Bearer WXYZ6789" } },
      CODE
    );
    expect(result).toEqual({ ok: false, status: 401 });
  });

  test("rejects a code that is a prefix of the real one", () => {
    const result = authorizeSyncRequest(
      { url: "/api/info", headers: { authorization: "Bearer ABCD" } },
      CODE
    );
    expect(result).toEqual({ ok: false, status: 401 });
  });

  test("rejects everything when no pairing code is configured", () => {
    const result = authorizeSyncRequest(
      { url: "/api/info", headers: { authorization: "Bearer " } },
      ""
    );
    expect(result).toEqual({ ok: false, status: 401 });
  });

  test("rejects a browser request from an origin outside the allowlist with 403, even with the code", () => {
    const result = authorizeSyncRequest(
      {
        url: "/api/favorites",
        headers: { origin: "https://evil.example", authorization: `Bearer ${CODE}` },
      },
      CODE
    );
    expect(result).toEqual({ ok: false, status: 403 });
  });

  test("allows a request from an allowlisted origin", () => {
    const result = authorizeSyncRequest(
      {
        url: "/api/videos",
        headers: { origin: "http://trusted.local", authorization: `Bearer ${CODE}` },
      },
      CODE,
      ["http://trusted.local"]
    );
    expect(result.ok).toBe(true);
  });

  test("rejects a missing url", () => {
    const result = authorizeSyncRequest(
      { url: undefined, headers: { authorization: `Bearer ${CODE}` } },
      CODE
    );
    expect(result).toEqual({ ok: false, status: 401 });
  });
});

describe("generatePairingCode", () => {
  test("produces an 8-character code from an unambiguous alphabet", () => {
    const code = generatePairingCode();
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{8}$/);
  });

  test("produces different codes on successive calls", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generatePairingCode()));
    expect(codes.size).toBe(20);
  });
});

describe("normalizePairingCode", () => {
  test("uppercases and strips separators and whitespace", () => {
    expect(normalizePairingCode(" abcd-2345 ")).toBe("ABCD2345");
  });
});
