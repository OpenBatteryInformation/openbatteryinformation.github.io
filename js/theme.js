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

/* Responsive navbar: toggle the burger menu on small screens. */
(function () {
  document.addEventListener("DOMContentLoaded", function () {
    var navbar = document.querySelector(".navbar");
    var toggle = document.getElementById("nav-toggle");
    if (!navbar || !toggle) return;
    toggle.addEventListener("click", function () {
      var open = navbar.classList.toggle("nav-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
    });
    navbar.addEventListener("click", function (e) {
      if (!navbar.classList.contains("nav-open")) return;
      var link = e.target.closest && e.target.closest("a");
      if (link) {
        navbar.classList.remove("nav-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Open navigation menu");
      }
    });
  });
})();
