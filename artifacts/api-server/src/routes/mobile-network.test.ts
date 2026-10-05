import { describe, it, expect, afterEach, vi } from "vitest";
import { customFetch, isPublicRead, setAuthTokenGetter, setBaseUrl, setRequestTimeout, setPublicReadAuthEnabled } from "../../../../lib/api-client-react/src/custom-fetch";

afterEach(() => {
  setAuthTokenGetter(null); setBaseUrl(null); setRequestTimeout(0);
  setPublicReadAuthEnabled(true);
  vi.useRealTimers(); vi.restoreAllMocks();
});
describe("mobile request behavior", () => {
  it("does not wait for auth to browse public products", async () => {
    const token = vi.fn(() => new Promise<string>(() => {}));
    setPublicReadAuthEnabled(false);
    setAuthTokenGetter(token);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('[]', { headers: { "content-type": "application/json" } }));
    expect(await customFetch("/api/products")).toEqual([]);
    expect(token).not.toHaveBeenCalled();
  });
  it("still authenticates private owner queries and writes", async () => {
    setAuthTokenGetter(() => "fixture-token");
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{}', { headers: { "content-type": "application/json" } }));
    await customFetch("/api/stores?ownerUserId=fixture");
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("authorization")).toBe("Bearer fixture-token");
    expect(isPublicRead("/api/stores/3/products", "GET")).toBe(true);
    expect(isPublicRead("/api/messages", "GET")).toBe(false);
    expect(isPublicRead("/api/stores", "POST")).toBe(false);
  });
  it("aborts stalled requests without retrying mutations", async () => {
    vi.useFakeTimers();
    setRequestTimeout(25);
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const failure = expect(customFetch("/api/stores", { method: "POST", body: "{}" })).rejects.toThrow("Aborted");
    await vi.advanceTimersByTimeAsync(30);
    await failure;
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
