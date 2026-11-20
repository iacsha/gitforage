// gitforage portal: the words. Every label and line of voice the portal shows lives
// here, so the field-guide voice stays in one place and the server pages and the
// browser-built cards always say the same thing.
//
// Only display text changes here. Source names (search, rising, fork, kin), config
// keys, URL parameters and the Keep/Skip issue titles ("keep: owner/name") are data
// and stay as they are.
//
// Plain fixed text only: nothing in this file is markup, and nothing in it comes
// from a repo or a visitor.

/** Where a candidate came from: the badge on a card and the source filter chip. */
export const SOURCE_LABELS = Object.freeze({
  search: Object.freeze({ label: "Seedlings", title: "Seedling: created recently in one of these topics" }),
  rising: Object.freeze({ label: "Thriving", title: "Thriving: an established repo gaining stars quickly" }),
  fork: Object.freeze({ label: "Wild forks", title: "Wild fork: a fork that is ahead of upstream and recently pushed" }),
  kin: Object.freeze({ label: "Kindred", title: "Kindred: shares the topics and words that are unusual among the profile's stars" }),
});

/** Recency of the last push, as the outer tree ring shows it. */
export const RING_WORDS = Object.freeze({
  fresh: "growing this week",
  recent: "growing this month",
  quiet: "quiet for a month or more",
  dormant: "dormant for three months or more",
});

/** Star momentum, as the width of the outer tree ring shows it. */
export const GROWTH_WORDS = Object.freeze(["no new stars measured", "a few new stars", "gaining stars", "gaining stars fast"]);

export const STRINGS = Object.freeze({
  // Pages
  discoverTitle: "This week's haul",
  discoverNav: "Discover",
  discoverLede: "Useful tools that fit these interests, ranked by fit rather than popularity. Every card says why it made the basket.",
  contributeTitle: "Lend a hand",
  contributeNav: "Get involved",
  contributeLede: "Projects worth tending: maintainers who merge outside pull requests and answer issues, starter issues, and wild forks ahead of upstream.",
  topicsNav: "Topics",
  topicsTitle: "Patches",
  topicsLede: "The patches this portal forages, and what it has found in each.",
  archiveNav: "Archive",
  archiveTitle: "Past hauls",
  archiveLede: "Every haul this portal has brought home, newest first.",
  aboutNav: "About",
  aboutTitle: "About this field guide",

  // Cards
  keep: "Keep",
  skip: "Leave it",
  specimen: "Specimen",
  specimenShort: "No.",
  habitat: "Habitat",
  found: "Found",
  pushed: "last growth",
  whyHere: "Why it made the basket",
  maintainerWords: "In the maintainer's words",
  noDescription: "No description left on the label.",
  maintainers: "Tended by",
  moreLikeThis: "More like this",
  hide: "Hide",

  // Lists, filters and the map
  sourceFilter: "Source",
  topicFilter: "Patch",
  clearFilters: "Clear filters",
  noMatch: "Nothing in the basket matches these filters.",
  mapTitle: "Forage map",
  mapNote: "Each hill is a patch; more contour lines, more finds. Pick one to show only its finds.",

  // The topic picker
  pickPatch: "Pick your patch",
  pickNote: "Your picks and marks stay in this browser. Nothing is sent to gitforage.",
  showMine: "Show my haul",

  // Empty states
  noDigestYet: "Nothing foraged yet. The first weekly walk fills this page.",
  nothingNew: "Nothing new on the last walk. Everything it found had been brought home before.",
});

/**
 * The field note on each card, written from structured numbers and allow-listed
 * names only (fieldnote.js), never from the repo's own description. Placeholders:
 * {age} {Age} {habitat} {where} {rooted} {growth} {n} {a} {t}. A template is picked
 * per repo from a hash of its name, so the same card always reads the same way.
 */
export const FIELD_NOTE = Object.freeze({
  age: Object.freeze(["young", "year-old", "seasoned", "seasoned", "old-growth"]),
  habitat: "{lang}",
  where: "in the {topic} patch",
  whereNone: "off the usual trails",
  rooted: "rooted in {lang}",
  rootedNone: "of no fixed habitat",
  openers: Object.freeze([
    "A {age} {habitat} specimen, spotted {where}.",
    "Found {where}: a {age} {habitat} specimen.",
    "{Age} {habitat} growth, turned up {where}.",
    "Spotted {where}, a {age} specimen {rooted}.",
    "A {age} find from {where}, {rooted}.",
  ]),
  sources: Object.freeze({
    search: Object.freeze(["Fresh from the seed bed.", "A seedling, new this season.", "Barely out of the soil."]),
    rising: Object.freeze(["Thriving: {growth}.", "Putting on growth: {growth}.", "A strong season: {growth}."]),
    fork: Object.freeze(["A wild fork, growing ahead of its parent.", "Sprouted from an older stem and outgrowing it.", "A wild cutting that took root on its own."]),
    kin: Object.freeze(["Kindred to the stars this guide follows.", "Close kin to the guide's favourite finds.", "Shares a root system with the guide's stars."]),
  }),
  welcomes: "Tended by maintainers who welcome outside hands: {n} outside {prs} merged in 90 days.",
  pr: "pull request",
  prs: "pull requests",
  answers: "They answered {a} of {t} recent issues.",
  growth: GROWTH_WORDS,
});
