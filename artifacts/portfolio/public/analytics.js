/* First-party, cookie-free analytics. No persistent visitor ID or URL capture. */
(() => {
  if (navigator.doNotTrack === "1" || navigator.globalPrivacyControl === true) return;
  const ids = ["hero", "about", "work", "skills", "contact"];
  const code = new URLSearchParams(window.location.search).get("client");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const clientCode = code && uuid.test(code) ? code : undefined;

  function start() {
    if (!ids.every(id => document.getElementById(id))) return false;
    if (!window.crypto?.randomUUID) return true; // Unsupported browsers skip tracking.
    const id = crypto.randomUUID(); // New page load, not a person identifier.
    let seconds = 0;
    const sections = {};
    let last = performance.now();
    let visible = document.visibilityState === "visible";
    let active = [];
    let dirty = true;

    function sample() {
      const now = performance.now();
      const delta = Math.min(Math.max((now - last) / 1000, 0), 14400 - seconds);
      if (visible && delta > 0) {
        seconds += delta;
        active.forEach(section => { sections[section] = Math.min(14400, sections[section] + delta); });
        dirty = true;
      }
      last = now;
      visible = document.visibilityState === "visible";
      active = visible ? ids.filter(section => {
        const rect = document.getElementById(section)?.getBoundingClientRect();
        if (!rect) return false;
        const shown = Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 80);
        return shown >= Math.min(120, rect.height * 0.25);
      }) : [];
      active.forEach(section => {
        if (!(section in sections)) { sections[section] = 0; dirty = true; }
      });
    }

    function send() {
      if (!dirty) return;
      const snapshot = JSON.stringify({
        id, clientCode, seconds: Math.floor(seconds),
        sections: Object.fromEntries(Object.entries(sections).map(([key, value]) => [key, Math.floor(value)])),
      });
      dirty = false;
      // The shared API owns /api for all artifacts. Never send browser cookies.
      // keepalive also sends the final cumulative snapshot on navigation.
      fetch("/api/portfolio-analytics/visit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "omit", body: snapshot, keepalive: true,
      }).then(response => { if (!response.ok) dirty = true; }).catch(() => { dirty = true; });
    }
    sample();
    send();
    setInterval(sample, 1000);
    setInterval(send, 15000);
    document.addEventListener("visibilitychange", () => { sample(); send(); });
    window.addEventListener("pagehide", () => { sample(); send(); });
    window.addEventListener("pageshow", () => { last = performance.now(); sample(); });
    return true;
  }

  if (!start()) {
    const observer = new MutationObserver(() => { if (start()) observer.disconnect(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
