// gitforage portal: "Pick your topics" on the Discover page (site.personalize).
//
// The visitor picks topics (or a starter pack, or lets their GitHub stars suggest some)
// and this page re-ranks the catalog for them, in their browser. Choices and local
// marks are kept in localStorage, and nothing is sent anywhere, except one thing the
// visitor asks for: "Use my GitHub stars" makes their browser call api.github.com.
//
// Safety rules for this file:
// - Every node is built with createElement and textContent. No markup is ever written.
// - Attributes come from a fixed allow-list (setAttr), and the only links are
//   https://github.com/<owner>/<repo> pages rebuilt from validated names.
// - catalog.json, the URL, localStorage and GitHub's responses all go through the
//   validators in personalize-core.js before use, and every read is size-capped.
// - Without JavaScript none of this runs, and the server-rendered digest is the page.
import * as core from "./personalize-core.js";

const KEYS = { picks: "gitforage-picks", marks: "gitforage-marks", stars: "gitforage-stars" };
/** Cards added to the personalized list at a time. */
const PAGE = 60;

const ATTRS = new Set([
  "class", "id", "href", "title", "datetime", "aria-label", "aria-labelledby", "aria-pressed", "type", "open",
  "data-lang", "data-lang-match", "data-sources", "data-topics", "data-score", "data-stars", "data-rank", "data-repo",
  "data-card", "data-local-marks", "data-local-mark", "data-local-hidden",
]);
const TAGS = new Set(["li", "article", "div", "h2", "a", "span", "p", "ul", "time", "button"]);
const BADGES = {
  fork: { label: "Live fork", cls: "badge badge-fork", title: "A fork that is ahead of upstream and recently pushed" },
  rising: { label: "Rising", cls: "badge badge-rising", title: "An established repo gaining stars quickly" },
  search: { label: "New", cls: "badge badge-new", title: "Created recently in one of these topics" },
  kin: { label: "Like your stars", cls: "badge badge-kin", title: "Shares the topics and words that are unusual among the profile's stars" },
};
const BADGE_ORDER = ["fork", "rising", "search", "kin"];

function read(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function save(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch (e) {
    // Storage blocked: the choice lasts for this page only.
  }
}

/** Set one attribute from the allow-list. Links must be GitHub links built from validated names. */
function setAttr(node, name, value) {
  if (!ATTRS.has(name)) throw new Error("attribute not allowed: " + name);
  const v = String(value);
  if (name === "href" && !core.SAFE_HREF_RE.test(v)) throw new Error("link not allowed");
  node.setAttribute(name, v);
}

/** A new element with allow-listed attributes and optional text. */
function el(tag, attrs, text) {
  if (!TAGS.has(tag)) throw new Error("tag not allowed: " + tag);
  const node = document.createElement(tag);
  if (attrs) for (const k of Object.keys(attrs)) setAttr(node, k, attrs[k]);
  if (text !== undefined) node.textContent = text;
  return node;
}

const q = (sel) => document.querySelector(sel);
const all = (sel, scope) => Array.prototype.slice.call((scope || document).querySelectorAll(sel));
const plural = (n, one) => n.toLocaleString("en-US") + " " + (n === 1 ? one : one + "s");

function announce(text) {
  const status = q("[data-pref-status]");
  if (status) status.textContent = text;
}

/** Read a response as text, refusing bodies over max bytes (by header, then while streaming). */
async function readCapped(res, max) {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw new Error("too large");
  if (!res.body || !res.body.getReader) {
    const text = await res.text();
    if (text.length > max) throw new Error("too large");
    return text;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > max) {
      reader.cancel().catch(function () {});
      throw new Error("too large");
    }
    chunks.push(step.value);
  }
  const buf = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { buf.set(c, at); at += c.byteLength; }
  return new TextDecoder("utf-8").decode(buf);
}

function init() {
  const bar = q("[data-personal-bar]");
  const dialog = q("[data-pick-dialog]");
  const list = q("[data-pcards]");
  const personal = q("[data-personal]");
  const defaultView = q("[data-default-view]");
  if (!bar || !dialog || !list || !personal || !defaultView) return;
  const openBtn = q("[data-pick-open]");
  const summary = q("[data-personal-summary]");
  const resetBtn = q("[data-personal-reset]");
  const copyBtn = q("[data-copy-link]");
  const shareWrap = q("[data-share-wrap]");
  const shareInput = q("[data-share-url]");
  const emptyMsg = q("[data-personal-empty]");
  const moreBtn = q("[data-personal-more]");
  const countLine = q("[data-pick-count]");
  const applyBtn = q("[data-pick-apply]");
  const search = q("[data-topic-search]");
  const noneMsg = q("[data-topic-none]");
  const userInput = q("[data-stars-user]");
  const starsBtn = q("[data-stars-go]");
  const starsStatus = q("[data-stars-status]");
  const cachedLine = q("[data-stars-cached]");
  const cachedText = q("[data-stars-cached-text]");
  const marksCount = q("[data-marks-count]");

  /** @type {ReturnType<typeof core.parseCatalog>} */
  let cat = null;
  let catPromise = null;
  let applied = { topics: [], pack: null };
  let pendingPack = null;
  let marks = core.readMarks(read(KEYS.marks));
  let ranked = [];
  let shown = 0;

  function loadCatalog() {
    if (cat) return Promise.resolve(cat);
    if (!catPromise) {
      catPromise = fetch("catalog.json", { credentials: "same-origin", redirect: "error" })
        .then(function (res) {
          if (!res.ok) throw new Error("status " + res.status);
          return readCapped(res, core.LIMITS.catalogBytes);
        })
        .then(function (text) {
          const c = core.parseCatalog(text);
          if (!c) throw new Error("bad catalog");
          cat = c;
          return c;
        })
        .catch(function (e) {
          catPromise = null;
          throw e;
        });
    }
    return catPromise;
  }

  function track(kind, value) {
    if (!cat || !cat.analytics) return;
    const name = core.eventName(kind, value);
    const gc = window.goatcounter;
    if (!name || !gc || typeof gc.count !== "function") return;
    try {
      gc.count({ path: name, title: name, event: true });
    } catch (e) {
      // Analytics must never break the page.
    }
  }

  function replaceUrl(query) {
    try {
      window.history.replaceState(null, "", window.location.pathname + query + window.location.hash);
    } catch (e) {
      // Some embedded browsers refuse; the view still works.
    }
  }

  // ---- Cards -----------------------------------------------------------------------

  function card(r, index) {
    const it = r.item;
    const url = core.repoUrl(it.full_name);
    if (!url || !cat) return null;
    const parts = it.full_name.split("/");
    const id = "p-" + it.full_name.replace(/[^A-Za-z0-9_-]/g, "-");
    const li = el("li", {
      "data-lang": it.lang, "data-lang-match": core.langMatches(cat, it.lang) ? "yes" : "no",
      "data-sources": it.sources.join(" "), "data-topics": r.hits.join(" "), "data-score": core.numAttr(r.score, 2),
      "data-stars": core.numAttr(it.stars), "data-rank": core.numAttr(index), "data-repo": it.full_name,
    });
    const art = el("article", { class: "card", id: id, "data-card": "", "aria-labelledby": id + "-t" });
    const head = el("div", { class: "card-head" });
    const h = el("h2", { class: "card-title", id: id + "-t" });
    const a = el("a", { href: url });
    a.appendChild(el("span", { class: "owner" }, parts[0] + "/"));
    a.appendChild(document.createTextNode(parts[1]));
    h.appendChild(a);
    head.appendChild(h);
    const score = el("p", { class: "score", title: "Fit score: the sum of the rule points" });
    score.appendChild(el("span", { class: "sr-only" }, "Score "));
    score.appendChild(document.createTextNode(core.numAttr(r.score, 1)));
    head.appendChild(score);
    const badges = el("p", { class: "badges" });
    for (const s of BADGE_ORDER) {
      if (it.sources.indexOf(s) >= 0) badges.appendChild(el("span", { class: BADGES[s].cls, title: BADGES[s].title }, BADGES[s].label));
    }
    head.appendChild(badges);
    art.appendChild(head);
    art.appendChild(it.description ? el("p", { class: "desc" }, it.description) : el("p", { class: "desc desc-none" }, "No description."));
    const chips = r.reasons.filter(function (x) { return x.points > 0 && x.text; }).slice(0, 4);
    if (chips.length) {
      const ul = el("ul", { class: "chips", "aria-label": "Why it is here" });
      for (const c of chips) ul.appendChild(el("li", null, c.text));
      art.appendChild(ul);
    }
    const meta = el("ul", { class: "meta" });
    meta.appendChild(el("li", { class: "meta-stars" }, plural(it.stars, "star")));
    if (it.language) meta.appendChild(el("li", { class: "meta-lang" }, it.language));
    const pushed = core.formatDate(it.pushed_at);
    if (pushed) {
      const p = el("li", { class: "meta-pushed" }, "pushed ");
      p.appendChild(el("time", { datetime: it.pushed_at }, pushed));
      meta.appendChild(p);
    }
    art.appendChild(meta);
    if (cat.portal) {
      const actions = el("div", { class: "actions" });
      const keep = core.feedbackUrl(cat.portal, "keep", it.full_name);
      const skip = core.feedbackUrl(cat.portal, "skip", it.full_name);
      if (keep && skip) {
        actions.appendChild(el("a", { class: "btn btn-keep", href: keep, "aria-label": "Keep " + it.full_name + ": opens a prefilled GitHub issue" }, "Keep"));
        actions.appendChild(el("a", { class: "btn btn-skip", href: skip, "aria-label": "Skip " + it.full_name + ": opens a prefilled GitHub issue" }, "Skip"));
        art.appendChild(actions);
      }
    }
    const local = el("div", { class: "local-marks", "data-local-marks": "" });
    local.appendChild(el("button", { type: "button", class: "local-btn", "data-local-mark": "keep", "aria-pressed": "false", "aria-label": "More like " + it.full_name + ", in this browser only" }, "More like this"));
    local.appendChild(el("button", { type: "button", class: "local-btn", "data-local-mark": "skip", "aria-pressed": "false", "aria-label": "Hide " + it.full_name + ", in this browser only" }, "Hide"));
    art.appendChild(local);
    li.appendChild(art);
    paintMarks(li);
    return li;
  }

  function addCards(n) {
    const first = shown;
    const end = Math.min(ranked.length, shown + n);
    for (let i = shown; i < end; i++) {
      const li = card(ranked[i], i);
      if (li) list.appendChild(li);
    }
    shown = end;
    moreBtn.hidden = shown >= ranked.length;
    if (moreBtn.hidden === false) moreBtn.textContent = "Show more (" + (ranked.length - shown).toLocaleString("en-US") + " left)";
    return first;
  }

  function renderPersonal() {
    if (!cat) return;
    ranked = core.rank(cat.items, applied.topics, marks, cat.weights);
    shown = 0;
    list.textContent = "";
    addCards(PAGE);
    emptyMsg.hidden = ranked.length > 0;
    personal.hidden = false;
    defaultView.hidden = true;
    summary.textContent = core.summaryText(ranked.length, applied.topics);
    resetBtn.hidden = false;
    copyBtn.hidden = false;
  }

  function showDefault() {
    personal.hidden = true;
    defaultView.hidden = false;
    list.textContent = "";
    ranked = [];
    shown = 0;
    summary.textContent = "";
    resetBtn.hidden = true;
    copyBtn.hidden = true;
    shareWrap.hidden = true;
  }

  /** Apply a validated selection: save it, put it in the URL, and show it (or the default view). */
  function applySelection(sel) {
    applied = { topics: sel.topics.slice(0, core.LIMITS.selected), pack: sel.pack };
    if (!applied.topics.length) {
      save(KEYS.picks, null);
      replaceUrl("");
      showDefault();
      return;
    }
    save(KEYS.picks, core.writePicks(applied));
    replaceUrl(core.queryFor(applied));
    renderPersonal();
  }

  // ---- Local marks -----------------------------------------------------------------

  function paintMarks(li) {
    const full = li.getAttribute("data-repo");
    const m = core.isFullName(full) ? marks[full] : undefined;
    for (const b of all("[data-local-mark]", li)) {
      setAttr(b, "aria-pressed", m && m.mark === b.getAttribute("data-local-mark") ? "true" : "false");
    }
    if (m && m.mark === "skip") setAttr(li, "data-local-hidden", "");
    else li.removeAttribute("data-local-hidden");
  }

  function paintMarksCount() {
    const n = Object.keys(marks).length;
    marksCount.textContent = n ? plural(n, "repo") + " marked in this browser." : "No marks yet.";
  }

  function markFacts(full, li) {
    const it = cat ? cat.items.find(function (x) { return x.full_name === full; }) : null;
    if (it) return { topics: it.topics.slice(0, core.LIMITS.markTopics), language: it.language };
    const topics = (li.getAttribute("data-topics") || "").split(" ").filter(core.isTopic).slice(0, core.LIMITS.markTopics);
    return { topics: topics, language: null };
  }

  document.addEventListener("click", function (e) {
    const btn = e.target && e.target.closest ? e.target.closest("[data-local-mark]") : null;
    if (!btn) return;
    const li = btn.closest("[data-repo]");
    const full = li ? li.getAttribute("data-repo") : null;
    const kind = btn.getAttribute("data-local-mark");
    if (!li || !core.isFullName(full) || (kind !== "keep" && kind !== "skip")) return;
    if (marks[full] && marks[full].mark === kind) delete marks[full];
    else {
      const f = markFacts(full, li);
      delete marks[full]; // re-adding puts it last, so the cap drops the oldest marks
      marks[full] = { mark: kind, topics: f.topics, language: f.language };
    }
    save(KEYS.marks, Object.keys(marks).length ? core.writeMarks(marks) : null);
    marks = core.readMarks(read(KEYS.marks) || core.writeMarks(marks));
    for (const x of all('[data-repo]')) if (x.getAttribute("data-repo") === full) paintMarks(x);
    paintMarksCount();
    const m = marks[full];
    announce(m ? (m.mark === "skip" ? "Hidden " + full + " in this browser. Clear your local marks under Pick your topics to undo." : "Marked " + full + ": more like this, in this browser.") : "Mark removed from " + full + ".");
    if (!personal.hidden) {
      const keepShown = shown;
      renderPersonal();
      if (keepShown > shown) addCards(keepShown - shown);
    }
  });

  // ---- The dialog ------------------------------------------------------------------

  const boxes = all("[data-topic]", dialog);
  const packBtns = all("[data-pack]", dialog);

  function checked() {
    return boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.getAttribute("data-topic"); });
  }
  function setChecks(topics) {
    for (const b of boxes) b.checked = topics.indexOf(b.getAttribute("data-topic")) >= 0;
  }
  function paintPacks() {
    for (const b of packBtns) setAttr(b, "aria-pressed", b.getAttribute("data-pack") === pendingPack ? "true" : "false");
  }
  function updateCount() {
    if (!cat) { countLine.textContent = "Loading the catalog…"; applyBtn.textContent = "Show my repos"; return; }
    const topics = checked();
    if (!topics.length) {
      countLine.textContent = "No topics picked: Show goes back to the default view.";
      applyBtn.textContent = "Show the default view";
      return;
    }
    const n = core.rank(cat.items, topics, marks, cat.weights).length;
    countLine.textContent = plural(n, "repo") + " for " + plural(topics.length, "topic") + ".";
    applyBtn.textContent = "Show " + plural(n, "repo");
  }
  function paintCached() {
    const c = cat ? core.readStarsCache(read(KEYS.stars), cat, Date.now()) : null;
    if (!c) { cachedLine.hidden = true; return; }
    cachedText.textContent = "From your stars on " + c.date + ": " + core.suggestTopics(c.weights).join(", ") + ".";
    cachedLine.hidden = false;
  }

  let opener = null;
  function openDialog() {
    opener = document.activeElement;
    setChecks(applied.topics);
    pendingPack = applied.pack;
    paintPacks();
    paintMarksCount();
    updateCount();
    starsStatus.textContent = "";
    if (typeof dialog.showModal === "function") dialog.showModal();
    else setAttr(dialog, "open", "");
    loadCatalog().then(function () { updateCount(); paintCached(); }, function () {
      countLine.textContent = "The catalog could not be loaded. Try again later.";
    });
  }
  function closeDialog() {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }
  dialog.addEventListener("close", function () {
    // Back to what opened it; the button when focus was nowhere useful (a script click, the body).
    const back = opener && opener !== document.body && opener.focus && document.contains(opener) ? opener : openBtn;
    if (back) back.focus();
  });
  // Keep Tab inside the dialog (showModal makes the page inert too; this covers older browsers).
  dialog.addEventListener("keydown", function (e) {
    if (e.key !== "Tab") return;
    const f = all("button, input, a[href]", dialog).filter(function (x) { return !x.disabled && x.getClientRects().length > 0; });
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  });

  openBtn.addEventListener("click", openDialog);
  for (const b of all("[data-pick-cancel]", dialog)) b.addEventListener("click", closeDialog);
  q("[data-pick-none]").addEventListener("click", function () {
    setChecks([]);
    pendingPack = null;
    paintPacks();
    updateCount();
  });
  for (const b of boxes) {
    b.addEventListener("change", function () {
      const p = cat && pendingPack ? cat.packs.find(function (x) { return x.id === pendingPack; }) : null;
      const now = checked();
      if (p && (p.topics.length !== now.length || p.topics.some(function (t) { return now.indexOf(t) < 0; }))) {
        pendingPack = null;
        paintPacks();
      }
      updateCount();
    });
  }
  for (const b of packBtns) {
    b.addEventListener("click", function () {
      const id = b.getAttribute("data-pack");
      const p = cat ? cat.packs.find(function (x) { return x.id === id; }) : null;
      if (!p) return;
      setChecks(p.topics);
      pendingPack = p.id;
      paintPacks();
      updateCount();
    });
  }
  applyBtn.addEventListener("click", function () {
    if (!cat) return;
    const before = applied;
    const sel = core.cleanSelection(checked(), pendingPack, cat);
    for (const t of sel.topics) if (before.topics.indexOf(t) < 0) track("topic", t);
    if (sel.pack && sel.pack !== before.pack) track("pack", sel.pack);
    closeDialog();
    applySelection(sel);
    announce(sel.topics.length ? core.summaryText(ranked.length, sel.topics) : "Showing the default view.");
  });

  search.addEventListener("input", function () {
    const term = String(search.value || "").trim().toLowerCase().slice(0, 50);
    let any = false;
    for (const g of all("[data-pick-group]", dialog)) {
      let visible = 0;
      for (const row of all("[data-topic-row]", g)) {
        const t = row.getAttribute("data-topic-row") || "";
        const show = !term || t.indexOf(term) >= 0;
        row.hidden = !show;
        if (show) visible++;
      }
      g.hidden = visible === 0;
      if (visible) any = true;
    }
    noneMsg.hidden = any;
  });

  // ---- Use my GitHub stars ----------------------------------------------------------

  async function lookup(login) {
    /** @type {string[][]} */
    const starred = [];
    for (let page = 1; page <= core.LIMITS.starredPages; page++) {
      const url = core.starredUrl(login, page);
      if (!url) return { error: "login" };
      let res;
      try {
        res = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", redirect: "error", mode: "cors" });
      } catch (e) {
        if (page === 1) return { error: "network" };
        break;
      }
      if (!res.ok) {
        if (page > 1) break;
        if (res.status === 404) return { error: "missing" };
        if (res.status === 403 || res.status === 429) return { error: "rate" };
        return { error: "other" };
      }
      let topics = null;
      try {
        topics = core.starredTopics(JSON.parse(await readCapped(res, core.LIMITS.starredBytes)));
      } catch (e) {
        topics = null;
      }
      if (!topics) {
        if (page === 1) return { error: "shape" };
        break;
      }
      for (const t of topics) starred.push(t);
      if (topics.length < core.LIMITS.starredPerPage) break;
    }
    return { starred: starred };
  }

  const STARS_ERRORS = {
    login: "That is not a GitHub username. Usernames are letters, digits and single hyphens, up to 39 characters.",
    missing: "GitHub has no user with that name.",
    rate: "GitHub allows 60 lookups an hour from your network; try again later.",
    network: "Could not reach GitHub. Check your connection and try again.",
    shape: "GitHub sent an answer this page could not read. Try again later.",
    other: "GitHub could not answer just now. Try again later.",
  };

  starsBtn.addEventListener("click", function () {
    const login = String(userInput.value || "").trim();
    if (!core.isLogin(login)) { starsStatus.textContent = STARS_ERRORS.login; return; }
    starsBtn.disabled = true;
    starsStatus.textContent = "Asking GitHub for the stars of " + login + "…";
    loadCatalog()
      .then(function () { return lookup(login); }, function () { return { error: "other" }; })
      .then(function (r) {
        starsBtn.disabled = false;
        if (r.error) { starsStatus.textContent = STARS_ERRORS[r.error] || STARS_ERRORS.other; return; }
        const weights = core.topicWeights(r.starred, cat);
        if (!weights.length) {
          starsStatus.textContent = "None of the " + plural(r.starred.length, "starred repo") + " carry this portal's topics often enough to suggest any.";
          return;
        }
        const picks = core.suggestTopics(weights);
        setChecks(picks);
        pendingPack = null;
        paintPacks();
        updateCount();
        save(KEYS.stars, core.writeStarsCache(weights, Date.now()));
        paintCached();
        track("stars", "used");
        starsStatus.textContent = "Picked " + plural(picks.length, "topic") + " from " + plural(r.starred.length, "starred repo") + ": " + picks.join(", ") + ". Press Show to see them.";
      });
  });
  q("[data-stars-reuse]").addEventListener("click", function () {
    const c = cat ? core.readStarsCache(read(KEYS.stars), cat, Date.now()) : null;
    if (!c) return;
    setChecks(core.suggestTopics(c.weights));
    pendingPack = null;
    paintPacks();
    updateCount();
  });
  q("[data-marks-clear]").addEventListener("click", function () {
    marks = core.readMarks(null);
    save(KEYS.marks, null);
    for (const li of all("[data-repo]")) paintMarks(li);
    paintMarksCount();
    updateCount();
    if (!personal.hidden) renderPersonal();
    announce("Local marks cleared.");
  });

  // ---- The bar: Reset, Copy link, Show more ----------------------------------------

  resetBtn.addEventListener("click", function () {
    applySelection({ topics: [], pack: null });
    announce("Showing the default view.");
    openBtn.focus();
  });
  copyBtn.addEventListener("click", function () {
    const link = window.location.origin + window.location.pathname + core.queryFor(applied);
    function fallback() {
      shareInput.value = link;
      shareWrap.hidden = false;
      shareInput.focus();
      shareInput.select();
      announce("Copy the link from the field.");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(function () { announce("Link copied."); }, fallback);
    else fallback();
  });
  moreBtn.addEventListener("click", function () {
    const first = addCards(PAGE);
    const link = list.children[first] ? list.children[first].querySelector(".card-title a") : null;
    if (link) link.focus();
  });

  // ---- Start ------------------------------------------------------------------------

  for (const li of all("[data-default-view] [data-repo]")) paintMarks(li);
  for (const m of all("[data-local-marks]")) m.hidden = false;
  bar.hidden = false;
  // Fetch the catalog at load only when the URL or a saved choice asks for a personal view.
  if (window.location.search || read(KEYS.picks) !== null) {
    loadCatalog().then(function (c) {
      const sel = core.parseParams(window.location.search, c) || core.readPicks(read(KEYS.picks), c);
      if (sel) applySelection(sel);
      else if (read(KEYS.picks) !== null) save(KEYS.picks, null);
    }, function () {
      announce("Your picked topics could not be loaded; showing the default view.");
    });
  }
}

init();
