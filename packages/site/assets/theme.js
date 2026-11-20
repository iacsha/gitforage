// gitforage portal: apply the visitor's saved theme and language choice before the
// page paints, so there is no flash of the wrong theme. Loaded in <head> without
// defer, from this site only (script-src 'self'). site.js wires up the buttons.
// Storage can be blocked (private windows, strict settings); then nothing is
// applied and the page follows the system theme and the portal's default languages.
(function () {
  "use strict";
  var root = document.documentElement;
  function read(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  var theme = read("gitforage-theme");
  if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme);
  var lang = read("gitforage-lang");
  if (lang === "only" || lang === "all") root.setAttribute("data-lang-filter", lang);
})();
