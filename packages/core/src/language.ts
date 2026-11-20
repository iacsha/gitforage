// Spoken-language detection for repo descriptions. No dependency, no API calls.
//
// Two steps:
// 1. Script: count the letters of each Unicode script. Han, kana and Hangul count
//    three times (one character is roughly a word), so "讓 AI agent 讀懂台灣醫療" reads
//    as Chinese while one CJK word in an English sentence does not. A non-Latin script
//    that has the most weight names the language (kana on top of Han means Japanese).
// 2. Latin: a small stopword vote between English and common other languages.
//
// Text this short or with no clear winner is "und" (undetermined). Words in capitals
// are acronyms (Proxmox VE, MIT licensed), not function words, so they do not vote.
// Topics are not used: they are ASCII slugs of product names ("proxmox-ve",
// "bluetooth-le") that read as Turkish or French function words once split.

export interface LanguageGuess {
  /** An ISO 639-1 code from LANGUAGES, or "und". */
  lang: string;
  /** 0 to 1. */
  confidence: number;
}

/** Every code detect() can return, with an English name. Also the allow-list for config and the portal. */
export const LANGUAGES: Record<string, string> = {
  en: "English", es: "Spanish", pt: "Portuguese", fr: "French", de: "German", it: "Italian", nl: "Dutch",
  tr: "Turkish", id: "Indonesian", vi: "Vietnamese",
  zh: "Chinese", ja: "Japanese", ko: "Korean", ru: "Russian", uk: "Ukrainian", ar: "Arabic", fa: "Persian",
  he: "Hebrew", hi: "Hindi", th: "Thai", el: "Greek", bn: "Bengali", ta: "Tamil", te: "Telugu", kn: "Kannada",
  ml: "Malayalam", gu: "Gujarati", pa: "Punjabi", ka: "Georgian", hy: "Armenian", km: "Khmer", lo: "Lao",
  my: "Burmese", am: "Amharic", si: "Sinhala",
  und: "Undetermined",
};

export const isLanguageCode = (v: unknown): v is string => typeof v === "string" && Object.hasOwn(LANGUAGES, v);

/** Scripts that map straight to one language. Han and kana are handled together. */
const SCRIPTS: [RegExp, string][] = [
  [/\p{Script=Hangul}/u, "ko"],
  [/\p{Script=Cyrillic}/u, "ru"],
  [/\p{Script=Arabic}/u, "ar"],
  [/\p{Script=Hebrew}/u, "he"],
  [/\p{Script=Devanagari}/u, "hi"],
  [/\p{Script=Thai}/u, "th"],
  [/\p{Script=Greek}/u, "el"],
  [/\p{Script=Bengali}/u, "bn"],
  [/\p{Script=Tamil}/u, "ta"],
  [/\p{Script=Telugu}/u, "te"],
  [/\p{Script=Kannada}/u, "kn"],
  [/\p{Script=Malayalam}/u, "ml"],
  [/\p{Script=Gujarati}/u, "gu"],
  [/\p{Script=Gurmukhi}/u, "pa"],
  [/\p{Script=Georgian}/u, "ka"],
  [/\p{Script=Armenian}/u, "hy"],
  [/\p{Script=Khmer}/u, "km"],
  [/\p{Script=Lao}/u, "lo"],
  [/\p{Script=Myanmar}/u, "my"],
  [/\p{Script=Ethiopic}/u, "am"],
  [/\p{Script=Sinhala}/u, "si"],
];
const HAN_RE = /\p{Script=Han}/u;
const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const LATIN_RE = /\p{Script=Latin}/u;
const LETTER_RE = /\p{L}/u;
/** Dense scripts: one character is about one word. */
const DENSE = 3;
/** Less weighted letter mass than this is too little to judge. */
const MIN_WEIGHT = 12;

/** Distinctive function words. A word may sit in several lists; it then votes for each. */
const STOPWORDS: Record<string, string[]> = {
  en: ["the", "and", "for", "with", "your", "you", "from", "that", "this", "into", "of", "to", "is", "are", "on", "by", "an", "it", "its", "or", "using", "based", "written", "built", "which", "without", "any", "every", "all", "one", "can", "will", "our", "my", "how", "what", "when", "where", "about", "over", "between", "lets", "be", "as", "at", "in", "a"],
  es: ["el", "la", "los", "las", "una", "uno", "del", "de", "y", "en", "para", "con", "por", "que", "es", "su", "tu", "sus", "como", "más", "sin", "sobre", "herramienta", "aplicación"],
  pt: ["o", "os", "as", "um", "uma", "do", "da", "dos", "das", "de", "e", "em", "no", "na", "para", "com", "por", "que", "é", "seu", "sua", "não", "mais", "como", "ferramenta", "aplicação"],
  fr: ["le", "la", "les", "un", "une", "des", "du", "de", "et", "en", "pour", "avec", "par", "que", "est", "sur", "dans", "vos", "votre", "pas", "plus", "outil"],
  de: ["der", "die", "das", "und", "ein", "eine", "einen", "mit", "für", "von", "zu", "ist", "auf", "den", "dem", "nicht", "sie", "ihre", "werkzeug", "deine", "dein"],
  it: ["il", "lo", "gli", "le", "un", "una", "di", "del", "della", "e", "per", "con", "che", "è", "su", "da", "non", "strumento", "tuo", "tua"],
  nl: ["de", "het", "een", "en", "van", "voor", "met", "op", "is", "niet", "je", "jouw", "wordt", "zijn", "naar", "dat"],
  tr: ["ve", "bir", "için", "ile", "bu", "da", "de", "olan", "gibi", "çok", "daha", "aracı", "nasıl"],
  id: ["dan", "yang", "untuk", "dengan", "di", "ke", "dari", "ini", "itu", "adalah", "anda", "dalam", "tidak", "aplikasi"],
  vi: ["và", "của", "cho", "các", "một", "những", "được", "với", "trong", "là", "không", "bạn", "này", "công", "cụ"],
};
const STOP = new Map<string, string[]>();
for (const [lang, words] of Object.entries(STOPWORDS)) for (const w of words) STOP.set(w, [...(STOP.get(w) ?? []), lang]);
/** Letters that only some Latin-script languages use: an extra vote each. */
const HINTS: [RegExp, string][] = [
  [/[ñ¿¡]/u, "es"], [/[ãõ]|ção/u, "pt"], [/[ßäöü]/u, "de"], [/[ğış]/u, "tr"],
  [/[ăâđêôơư]|[ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/u, "vi"], [/[èêëîïœ]/u, "fr"],
];

const r2 = (n: number) => Math.round(n * 100) / 100;

function latinVote(text: string): LanguageGuess {
  const votes: Record<string, number> = {};
  for (const word of text.match(/\p{L}+/gu) ?? []) {
    if (word.length > 1 && word === word.toUpperCase()) continue; // an acronym
    for (const l of STOP.get(word.toLowerCase()) ?? []) votes[l] = (votes[l] ?? 0) + 1;
  }
  for (const [re, l] of HINTS) if (re.test(text.toLowerCase())) votes[l] = (votes[l] ?? 0) + 1;
  // English wins ties it shares with nobody; a tie between English and another language is undetermined.
  const order = Object.keys(STOPWORDS);
  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]));
  if (!ranked.length) return { lang: "und", confidence: 0 };
  const [[best, n], second] = ranked;
  const runnerUp = second?.[1] ?? 0;
  if (n === runnerUp && (best === "en" || second?.[0] === "en")) return { lang: "und", confidence: 0 };
  const total = ranked.reduce((s, [, v]) => s + v, 0);
  return { lang: best, confidence: r2((n / total) * Math.min(1, n / 3)) };
}

/** Guess the natural language of a description. `extra` (a README excerpt, when one was fetched anyway) joins the stopword vote only. */
export function detectLanguage(description: string, extra: string[] = []): LanguageGuess {
  const text = String(description ?? "").slice(0, 2000);
  // Acronyms (FHIR, MCP, SNOMED CT) are the same in every language, so they do not
  // count towards the Latin script either.
  const letters = text.replace(/\b[A-Z][A-Z0-9]+\b/g, " ");
  let han = 0, kana = 0, latin = 0, total = 0;
  const other: Record<string, number> = {};
  for (const ch of letters) {
    if (!LETTER_RE.test(ch)) continue;
    if (HAN_RE.test(ch)) { han += DENSE; total += DENSE; continue; }
    if (KANA_RE.test(ch)) { kana += DENSE; total += DENSE; continue; }
    if (LATIN_RE.test(ch)) { latin++; total++; continue; }
    const hit = SCRIPTS.find(([re]) => re.test(ch));
    const w = hit && ["ko", "th", "km", "lo", "my"].includes(hit[1]) ? DENSE : 1;
    if (hit) other[hit[1]] = (other[hit[1]] ?? 0) + w;
    total += w;
  }
  if (total < MIN_WEIGHT) return { lang: "und", confidence: 0 };
  const buckets: [string, number][] = [["latin", latin], ["cjk", han + kana], ...Object.entries(other)];
  buckets.sort((a, b) => b[1] - a[1]);
  const [top, weight] = buckets[0];
  const share = r2(weight / total);
  if (top === "cjk") return { lang: kana >= Math.max(2 * DENSE, 0.1 * (han + kana)) ? "ja" : "zh", confidence: share };
  if (top === "ru") return { lang: /[іїєґ]/iu.test(text) ? "uk" : "ru", confidence: share };
  if (top === "ar") return { lang: /[پچژگکی]/u.test(text) ? "fa" : "ar", confidence: share };
  if (top !== "latin") return { lang: top, confidence: share };
  const vote = latinVote([text, ...extra.map((t) => String(t).slice(0, 2000))].join(" "));
  return vote.lang === "und" ? vote : { lang: vote.lang, confidence: r2(vote.confidence * share) };
}
