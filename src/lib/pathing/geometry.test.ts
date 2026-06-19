import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchRoute, routingProfileFor } from "./geometry";

afterEach(() => vi.restoreAllMocks());

describe("routingProfileFor", () => {
  it("maps car->driving, walk->foot, others->null", () => {
    expect(routingProfileFor("car")).toBe("driving");
    expect(routingProfileFor("walk")).toBe("foot");
    expect(routingProfileFor("plane")).toBeNull();
    expect(routingProfileFor("train")).toBeNull();
    expect(routingProfileFor("boat")).toBeNull();
  });
});

describe("fetchRoute", () => {
  it("requests the chosen profile and returns the line", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [{ geometry: { coordinates: [[0, 0], [1, 1]] } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await fetchRoute([0, 0], [1, 1], "foot");
    expect(out).toEqual([[0, 0], [1, 1]]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/route/v1/foot/");
  });

  it("retries once on transient failure then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: "Ok",
          routes: [{ geometry: { coordinates: [[0, 0], [2, 2]] } }],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const out = await fetchRoute([0, 0], [2, 2], "driving");
    expect(out).toEqual([[0, 0], [2, 2]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null after exhausting retries", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchRoute([0, 0], [1, 1], "driving")).toBeNull();
  });

  it("returns null on a routing 'NoRoute' response (no retry)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: "NoRoute", routes: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchRoute([0, 0], [1, 1], "driving")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
