import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const script = readFileSync(new URL("../../../portfolio/public/analytics.js", import.meta.url), "utf8");

function browser(options: { dnt?: string; gpc?: boolean; ready?: boolean } = {}) {
  let now = 0;
  let ready = options.ready ?? true;
  let onMutation: () => void = () => {};
  const listeners: Record<string, () => void> = {};
  const timers: Record<number, () => void> = {};
  const fetch = vi.fn().mockResolvedValue({ ok: true });
  const positions: Record<string, { top: number; bottom: number; height: number }> = {
    hero: { top: 80, bottom: 700, height: 620 },
  };
  const doc = {
    visibilityState: "visible", documentElement: {},
    getElementById: (id: string) => ready ? {
      getBoundingClientRect: () => positions[id] ?? { top: 2000, bottom: 2500, height: 500 },
    } : null,
    addEventListener: (name: string, callback: () => void) => { listeners[name] = callback; },
  };
  const win = {
    location: { search: "?client=2bb35504-5338-4d51-b853-9cddc5747451" },
    crypto: { randomUUID: () => "8ab35504-5338-4d51-b853-9cddc5747451" },
    addEventListener: (name: string, callback: () => void) => { listeners[name] = callback; },
  };
  runInNewContext(script, {
    window: win, document: doc, crypto: win.crypto, navigator: { doNotTrack: options.dnt, globalPrivacyControl: options.gpc },
    URLSearchParams, performance: { now: () => now }, innerHeight: 800, fetch,
    setInterval: (callback: () => void, interval: number) => { timers[interval] = callback; },
    MutationObserver: class { constructor(callback: () => void) { onMutation = callback; } observe() {} disconnect() {} },
  });
  return { fetch, doc, listeners, positions, timers,
    advance: (seconds: number) => { now += seconds * 1000; timers[1000]?.(); },
    mount: () => { ready = true; onMutation(); },
    snapshot: () => JSON.parse(fetch.mock.calls.at(-1)![1].body),
  };
}

describe("cookie-free browser tracker", () => {
  it("waits for React sections and records only one initial pageview", () => {
    const b = browser({ ready: false });
    expect(b.fetch).not.toHaveBeenCalled();
    b.mount();
    expect(b.fetch).toHaveBeenCalledOnce();
    expect(b.snapshot().seconds).toBe(0);
    expect(b.snapshot().sections).toEqual({ hero: 0 });
    expect(b.fetch.mock.calls[0][1].credentials).toBe("omit");
    expect(b.fetch.mock.calls[0][1].keepalive).toBe(true);
  });
  it.each([{ dnt: "1" }, { gpc: true }])("sends nothing for privacy opt-out %j", options => {
    const b = browser(options);
    expect(b.fetch).not.toHaveBeenCalled();
    expect(Object.keys(b.timers)).toHaveLength(0);
  });
  it("sends cumulative time with the same page ID and excludes hidden-tab time", () => {
    const b = browser();
    const id = b.snapshot().id;
    b.advance(15); b.timers[15000]();
    expect(b.snapshot().seconds).toBe(15);
    b.doc.visibilityState = "hidden"; b.listeners.visibilitychange();
    b.advance(60); b.timers[15000]();
    expect(b.snapshot().seconds).toBe(15);
    b.doc.visibilityState = "visible"; b.listeners.visibilitychange();
    b.advance(5); b.listeners.pagehide();
    expect(b.snapshot()).toMatchObject({ id, seconds: 20, sections: { hero: 20 } });
  });
  it("tracks viewed sections independently and includes them at zero seconds", () => {
    const b = browser();
    b.advance(10);
    b.positions.hero = { top: -1000, bottom: -380, height: 620 };
    b.positions.about = { top: 80, bottom: 500, height: 420 };
    b.advance(0); b.timers[15000]();
    expect(b.snapshot().sections).toEqual({ hero: 10, about: 0 });
    b.advance(5); b.listeners.pagehide();
    expect(b.snapshot().sections).toEqual({ hero: 10, about: 5 });
  });
  it("caps time at four hours and never captures URL, email, IP or storage", () => {
    const b = browser();
    b.advance(20000); b.listeners.pagehide();
    expect(b.snapshot().seconds).toBe(14400);
    expect(Object.keys(b.snapshot()).sort()).toEqual(["clientCode", "id", "seconds", "sections"]);
    expect(script).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });
});
