// gitforage portal: keyboard shortcuts, and the theme and language buttons.
// j and k move between visible cards; Enter opens the focused card's repo (it is a
// normal link). The buttons save the choice in localStorage when it is available
// (theme.js applies it on the next page before paint). No network; text only, never markup.
(function () {
  "use strict";
  var current = -1;

  var root = document.documentElement;

  function cards() {
    return Array.prototype.slice.call(document.querySelectorAll("[data-card]")).filter(function (c) {
      return c.getClientRects().length > 0; // skip cards hidden by the language choice
    });
  }

  function save(key, value) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch (e) {
      // Storage blocked: the choice lasts for this page only.
    }
  }

  function announce(text) {
    var status = document.querySelector("[data-pref-status]");
    if (status) status.textContent = text;
  }

  // Theme: System, then Light, then Dark. System removes the override.
  var THEMES = ["system", "light", "dark"];
  var THEME_NAMES = { system: "System", light: "Light", dark: "Dark" };
  function theme() {
    var t = root.getAttribute("data-theme");
    return t === "light" || t === "dark" ? t : "system";
  }
  function paintTheme(btn) {
    var t = theme();
    var next = THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];
    btn.setAttribute("aria-label", "Theme: " + THEME_NAMES[t] + ". Switch to " + THEME_NAMES[next]);
    var label = btn.querySelector("[data-theme-label]");
    if (label) label.textContent = THEME_NAMES[t];
  }
  var themeBtn = document.querySelector("[data-theme-toggle]");
  if (themeBtn) {
    paintTheme(themeBtn);
    themeBtn.hidden = false;
    themeBtn.addEventListener("click", function () {
      var next = THEMES[(THEMES.indexOf(theme()) + 1) % THEMES.length];
      if (next === "system") root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", next);
      save("gitforage-theme", next === "system" ? null : next);
      paintTheme(themeBtn);
      announce("Theme: " + THEME_NAMES[next]);
    });
  }

  // Language: only the portal's languages, or all. The default comes from the page.
  function langOnly() {
    var f = root.getAttribute("data-lang-filter");
    return f ? f === "only" : root.getAttribute("data-lang-default") === "only";
  }
  var langBtn = document.querySelector("[data-lang-toggle]");
  if (langBtn) {
    langBtn.setAttribute("aria-pressed", langOnly() ? "true" : "false");
    langBtn.hidden = false;
    langBtn.addEventListener("click", function () {
      var only = !langOnly();
      root.setAttribute("data-lang-filter", only ? "only" : "all");
      save("gitforage-lang", only ? "only" : "all");
      langBtn.setAttribute("aria-pressed", only ? "true" : "false");
      var hidden = document.querySelectorAll('[data-lang-match="no"]').length;
      announce(only ? "Showing " + langBtn.textContent.trim() + (hidden ? ", " + hidden + " hidden" : "") : "Showing all languages");
    });
  }

  function focusCard(i) {
    var list = cards();
    if (!list.length) return;
    current = Math.max(0, Math.min(list.length - 1, i));
    var link = list[current].querySelector(".card-title a");
    if (link) {
      link.focus();
      link.scrollIntoView({ block: "nearest" });
    }
  }

  function typing(t) {
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }

  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || typing(e.target)) return;
    if (e.key !== "j" && e.key !== "k") return;
    var list = cards();
    var at = -1;
    for (var i = 0; i < list.length; i++) if (list[i].contains(document.activeElement)) at = i;
    var from = at >= 0 ? at : current;
    focusCard(e.key === "j" ? from + 1 : from < 0 ? 0 : from - 1);
    e.preventDefault();
  });
})();
