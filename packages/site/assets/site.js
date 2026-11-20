// gitforage portal: keyboard shortcuts, the theme, language and density controls,
// and the sort, View and filter bar above each list.
// j and k move between visible cards, in the order shown; Enter opens the focused
// card's repo (it is a normal link). Choices are saved in localStorage when it is
// available (theme.js applies them on the next page before paint). Filters last for
// the page only. Every value read from the page or from storage is checked against a
// fixed list or parsed as a number. No network; text only, never markup.
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
      applyFilters();
    });
  }

  function each(selector, fn) {
    var list = document.querySelectorAll(selector);
    for (var i = 0; i < list.length; i++) fn(list[i], i);
  }

  // Density: Comfortable, Compact or List, a radio group of buttons.
  var DENSITIES = ["comfortable", "compact", "list"];
  var DENSITY_NAMES = { comfortable: "Comfortable", compact: "Compact", list: "List" };
  function density() {
    var d = root.getAttribute("data-density");
    return DENSITIES.indexOf(d) >= 0 ? d : "comfortable";
  }
  function paintDensity() {
    var d = density();
    each("[data-density-option]", function (b) {
      var on = b.getAttribute("data-density-option") === d;
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.setAttribute("tabindex", on ? "0" : "-1");
    });
  }
  function setDensity(d, focus) {
    if (DENSITIES.indexOf(d) < 0) return;
    root.setAttribute("data-density", d);
    save("gitforage-density", d);
    paintDensity();
    if (focus) {
      var b = document.querySelector('[data-density-option="' + d + '"]');
      if (b) b.focus();
    }
    announce("Density: " + DENSITY_NAMES[d]);
  }
  var densityGroup = document.querySelector("[data-density-group]");
  if (densityGroup) {
    paintDensity();
    densityGroup.hidden = false;
    densityGroup.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-density-option]") : null;
      if (b) setDensity(b.getAttribute("data-density-option"), false);
    });
    densityGroup.addEventListener("keydown", function (e) {
      var step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      var at = DENSITIES.indexOf(density());
      if (e.key === "Home") at = 0;
      else if (e.key === "End") at = DENSITIES.length - 1;
      else if (step) at = (at + step + DENSITIES.length) % DENSITIES.length;
      else return;
      e.preventDefault();
      setDensity(DENSITIES[at], true);
    });
  }

  // Card fields: the View menu's checkboxes hide reasons, the maintainer line,
  // language or stars. The state is data-fields-off on <html>, a list of fixed names.
  var FIELDS = ["reasons", "health", "language", "stars"];
  function fieldsOff() {
    var parts = (root.getAttribute("data-fields-off") || "").split(" ");
    return FIELDS.filter(function (f) { return parts.indexOf(f) >= 0; });
  }
  each("[data-field]", function (box) {
    var f = box.getAttribute("data-field");
    if (FIELDS.indexOf(f) < 0) return;
    box.checked = fieldsOff().indexOf(f) < 0;
    box.addEventListener("change", function () {
      var off = fieldsOff().filter(function (x) { return x !== f; });
      if (!box.checked) off.push(f);
      var value = FIELDS.filter(function (x) { return off.indexOf(x) >= 0; }).join(" ");
      root.setAttribute("data-fields-off", value);
      save("gitforage-fields", value);
    });
  });
  each("details.view-menu", function (menu) {
    menu.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || !menu.open) return;
      menu.open = false;
      var summary = menu.querySelector("summary");
      if (summary) summary.focus();
      e.preventDefault();
    });
  });

  // Sort: reorder the cards from numbers the build wrote into data-* attributes.
  // Highest first; ties keep the build's order (data-rank). The build already sorted
  // by the portal's default, so with JavaScript off the order is the same.
  var SORTS = ["score", "newest", "stars", "rising"];
  var SORT_NAMES = { score: "score", newest: "newest", stars: "stars", rising: "rising" };
  function num(el, name) {
    var n = Number(el.getAttribute("data-" + name));
    return isFinite(n) ? n : 0;
  }
  function sortCards(key) {
    if (SORTS.indexOf(key) < 0) return;
    each("[data-cards]", function (list) {
      var items = Array.prototype.slice.call(list.children);
      items.sort(function (a, b) { return num(b, key) - num(a, key) || num(a, "rank") - num(b, "rank"); });
      for (var i = 0; i < items.length; i++) list.appendChild(items[i]);
    });
    current = -1;
  }
  var sortSelect = document.querySelector("[data-sort-select]");
  if (sortSelect) {
    var serverSort = root.getAttribute("data-sort-default");
    var savedSort = null;
    try {
      savedSort = window.localStorage.getItem("gitforage-sort");
    } catch (e) {
      savedSort = null;
    }
    if (SORTS.indexOf(savedSort) >= 0 && savedSort !== serverSort) {
      sortSelect.value = savedSort;
      sortCards(savedSort);
    }
    sortSelect.addEventListener("change", function () {
      var key = sortSelect.value;
      if (SORTS.indexOf(key) < 0) return;
      sortCards(key);
      save("gitforage-sort", key === serverSort ? null : key);
      announce("Sorted by " + SORT_NAMES[key]);
    });
  }

  // Filters: source and topic chips. Within a group a card matches any pressed chip;
  // across groups it must match every group that has one pressed.
  var active = { source: [], topic: [] };
  function tokens(el, name) {
    return (el.getAttribute(name) || "").split(" ");
  }
  function matches(li) {
    function group(kind, attr) {
      if (!active[kind].length) return true;
      var have = tokens(li, attr);
      return active[kind].some(function (v) { return have.indexOf(v) >= 0; });
    }
    return group("source", "data-sources") && group("topic", "data-topics");
  }
  function langHidden(li) {
    return langOnly() && li.getAttribute("data-lang-match") === "no";
  }
  function applyFilters() {
    var shown = 0, total = 0;
    each("[data-cards] > li", function (li) {
      var ok = matches(li);
      li.hidden = !ok;
      if (langHidden(li)) return;
      total++;
      if (ok) shown++;
    });
    var any = active.source.length + active.topic.length > 0;
    each(".filter-row [data-filter-clear]", function (b) { b.hidden = !any; });
    each("[data-filter-empty]", function (p) { p.hidden = !(any && shown === 0 && total > 0); });
    var text = shown + " shown of " + total;
    each("[data-filter-count]", function (p) { p.textContent = text; });
    paintMap();
  }
  // The forage map: each hill links to its patch's page, which works without
  // JavaScript. Here a click presses the matching topic chip instead, when this list
  // has one and the default list is showing. Values are compared, never put into a selector.
  function paintMap() {
    each("[data-map-topic]", function (hill) {
      var on = active.topic.indexOf(hill.getAttribute("data-map-topic")) >= 0;
      hill.classList.toggle("is-on", on);
      if (on) hill.setAttribute("aria-current", "true");
      else hill.removeAttribute("aria-current");
    });
  }
  each("[data-map-topic]", function (hill) {
    hill.addEventListener("click", function (e) {
      var value = hill.getAttribute("data-map-topic");
      var view = document.querySelector("[data-default-view]");
      if (!value || (view && view.hidden)) return;
      var chips = document.querySelectorAll('[data-filter="topic"]');
      for (var i = 0; i < chips.length; i++) {
        if (chips[i].getAttribute("data-value") === value) {
          e.preventDefault();
          chips[i].click();
          return;
        }
      }
    });
  });
  each("[data-filter]", function (chip) {
    var kind = chip.getAttribute("data-filter");
    var value = chip.getAttribute("data-value");
    if ((kind !== "source" && kind !== "topic") || !value) return;
    chip.addEventListener("click", function () {
      var list = active[kind];
      var at = list.indexOf(value);
      if (at >= 0) list.splice(at, 1);
      else list.push(value);
      chip.setAttribute("aria-pressed", at >= 0 ? "false" : "true");
      applyFilters();
    });
  });
  each("[data-filter-clear]", function (b) {
    b.addEventListener("click", function () {
      active.source = [];
      active.topic = [];
      each("[data-filter]", function (chip) { chip.setAttribute("aria-pressed", "false"); });
      applyFilters();
      var first = document.querySelector("[data-filter]");
      if (first) first.focus();
    });
  });
  var bar = document.querySelector("[data-view-bar]");
  if (bar) {
    applyFilters();
    bar.hidden = false;
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
