/* Light/dark theme. Applies <html data-theme="dark|light">, persists the
   choice in localStorage and falls back to the OS preference. */
(function () {
  var KEY = "obi-theme";

  function initialTheme() {
    try {
      var saved = localStorage.getItem(KEY);
      if (saved === "dark" || saved === "light") return saved;
    } catch (e) {
      /* storage unavailable */
    }
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
      return "light";
    }
    return "dark";
  }

  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    var btn = document.getElementById("theme-toggle");
    if (btn) {
      var next = theme === "light" ? "dark" : "light";
      btn.setAttribute("aria-label", "Switch to " + next + " mode");
      btn.setAttribute("title", "Switch to " + next + " mode");
    }
  }

  apply(initialTheme());

  document.addEventListener("DOMContentLoaded", function () {
    var theme = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    apply(theme);
    var btn = document.getElementById("theme-toggle");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
      try {
        localStorage.setItem(KEY, next);
      } catch (e) {
        /* ignore */
      }
      apply(next);
    });
  });
})();
