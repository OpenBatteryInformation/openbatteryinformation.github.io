/* Populate footer with the latest release version from GitHub.
   Tries the public API with a short timeout and silently falls back on failure. */
(function () {
  const repo = "OpenBatteryInformation/openbatteryinformation.github.io";
  const url = "https://api.github.com/repos/" + repo + "/releases/latest";

  async function fetchLatest() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.tag_name) return data.tag_name;
      return null;
    } catch (e) {
      return null;
    }
  }

  function setVersion(version) {
    const el = document.getElementById("footer-latest-version");
    if (el) {
      el.textContent = version || "—";
    }
  }

  fetchLatest().then(setVersion).catch(() => setVersion(null));
})();
