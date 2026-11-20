// gitforage portal: apply the visitor's saved theme, language, density and card
// fields before the page paints, so there is no flash of the wrong layout. Loaded
// in <head> without defer, from this site only (script-src 'self'). site.js wires
// up the controls. Storage can be blocked (private windows, strict settings); then
// nothing is applied and the page keeps the system theme and the portal's defaults,
// which the server already wrote onto <html>. Only known values are accepted.
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
  var density = read("gitforage-density");
  if (density === "comfortable" || density === "compact" || density === "list") root.setAttribute("data-density", density);
  // Hidden card fields, space-separated. An empty string means every field shows.
  var fields = read("gitforage-fields");
  if (typeof fields === "string" && fields.length <= 64) {
    var FIELDS = ["reasons", "health", "language", "stars"];
    var off = [];
    var parts = fields.split(" ");
    for (var i = 0; i < parts.length; i++) {
      if (FIELDS.indexOf(parts[i]) >= 0 && off.indexOf(parts[i]) < 0) off.push(parts[i]);
    }
    root.setAttribute("data-fields-off", off.join(" "));
  }
})();
