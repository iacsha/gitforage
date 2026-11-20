import { describe, expect, test } from "bun:test";
import { detectLanguage, isLanguageCode, LANGUAGES } from "../src/language.ts";
import { exclusionReason, spokenReason } from "../src/exclude.ts";
import { ConfigError, validateConfig } from "../src/config.ts";
import { forage } from "../src/forage.ts";
import { GitHub } from "../src/github.ts";
import { cand, cfg, fakeApi, json, NOW, rawRepo } from "./helpers.ts";

describe("detectLanguage", () => {
  const cases: [string, string][] = [
    ["让你的命令行 Agent 在后台自己接活、自己跟进到底；平时不烦你，遇到拿不准的事才发卡片找你拍板。", "zh"],
    ["讓 AI agent 讀懂台灣醫療：63 個 MCP 工具，涵蓋 FHIR R4 / TW Core 驗證、ICD-10、SNOMED CT", "zh"],
    // healthymind-tech/Taiwan-Health-MCP on the demo run: Chinese first, one English sentence after.
    ["讓 AI agent 讀懂台灣醫療：63 個 MCP 工具，涵蓋 FHIR R4 / TW Core 驗證、ICD-10、SNOMED CT、LOINC、TFDA 藥品與臨床計算器。MCP server for Taiwan healthcare data.", "zh"],
    ["ターミナルで動くシンプルなタスク管理ツールです。", "ja"],
    ["HL7 メッセージを解析して FHIR に変換するライブラリ", "ja"],
    ["터미널에서 사용하는 간단한 파일 관리자입니다", "ko"],
    ["Простой инструмент командной строки для управления контейнерами", "ru"],
    ["Una herramienta de línea de comandos para gestionar contenedores en tu servidor", "es"],
    ["Ferramenta de linha de comando para gerenciar contêineres no seu servidor", "pt"],
    ["Un outil en ligne de commande pour gérer vos conteneurs avec Docker", "fr"],
    ["Ein Werkzeug für die Kommandozeile, mit dem du deine Container verwaltest", "de"],
    ["أداة بسيطة لإدارة الحاويات من سطر الأوامر", "ar"],
    ["כלי פשוט לניהול קונטיינרים משורת הפקודה", "he"],
    ["कमांड लाइन से कंटेनर प्रबंधित करने का सरल उपकरण", "hi"],
    ["เครื่องมือจัดการคอนเทนเนอร์แบบง่ายจากบรรทัดคำสั่ง", "th"],
  ];
  for (const [text, lang] of cases) {
    test(`${lang}: ${text.slice(0, 30)}`, () => {
      const g = detectLanguage(text);
      expect(g.lang).toBe(lang);
      expect(g.confidence).toBeGreaterThan(0);
      expect(g.confidence).toBeLessThanOrEqual(1);
    });
  }

  test("English stays English", () => {
    for (const d of [
      "Control your FHIR Server from the Command Line",
      "Scan, fuzz, and assess OT protocols from one CLI.",
      "Reverse engineer anything with agents, from app behavior down to native code",
      "Open-source Electronic Medical Records (EMR) for Canadian healthcare",
    ]) expect(detectLanguage(d).lang).toBe("en");
  });

  test("acronyms and product names do not vote (seen on the demo run)", () => {
    expect(detectLanguage("Proxmox VE inside a Docker container.").lang).toBe("en");
    expect(detectLanguage("Proxmox VE Helper-Scripts (Community Edition)").lang).toBe("und");
    expect(detectLanguage("Free, open-source local AWS emulator, Terraform compatible, real databases. MIT licensed.").lang).toBe("und");
    expect(detectLanguage("Open-source LIMS for medical diagnostics. HL7 v2.5.1 & FHIR R4 native, self-hosted, MIT-licensed.").lang).toBe("en");
  });

  test("an English description with one CJK word stays English", () => {
    expect(detectLanguage("A fast CLI for converting 中文 text to pinyin and back").lang).toBe("en");
    expect(detectLanguage("Render your 日本語 subtitles in the terminal with the right fonts").lang).toBe("en");
  });

  test("empty, short and ambiguous text is undetermined", () => {
    expect(detectLanguage("")).toEqual({ lang: "und", confidence: 0 });
    expect(detectLanguage("CLI")).toEqual({ lang: "und", confidence: 0 });
    expect(detectLanguage("中文")).toEqual({ lang: "und", confidence: 0 });
    expect(detectLanguage("Self-hosted photo management").lang).toBe("und");
  });

  test("only codes from the allow-list come back", () => {
    for (const s of ["", "hello world from the terminal", "中文的描述文本内容", "Привет мир это тест"]) {
      expect(isLanguageCode(detectLanguage(s).lang)).toBe(true);
    }
    expect(isLanguageCode("en")).toBe(true);
    expect(isLanguageCode("xx")).toBe(false);
    expect(isLanguageCode("__proto__")).toBe(false);
    expect(isLanguageCode("constructor")).toBe(false);
    expect(Object.keys(LANGUAGES).every((k) => /^[a-z]{2,3}$/.test(k))).toBe(true);
  });
});

describe("filters.spoken_languages", () => {
  test("is validated against the language codes", () => {
    expect(validateConfig({ topics: ["x"], filters: { spoken_languages: ["EN", "es"] } }).filters.spoken_languages).toEqual(["en", "es"]);
    expect(() => validateConfig({ topics: ["x"], filters: { spoken_languages: ["english"] } })).toThrow(ConfigError);
    expect(() => validateConfig({ topics: ["x"], filters: { spoken_languages: ["und"] } })).toThrow(ConfigError);
    expect(() => validateConfig({ topics: ["x"], filters: { drop_undetected: "yes" } })).toThrow(ConfigError);
    const d = validateConfig({ topics: ["x"] }).filters;
    expect(d.spoken_languages).toEqual([]);
    expect(d.drop_undetected).toBe(false);
  });

  const zh = cand("KKKKhazix/agent-autoloop", {}, { description: "让你的命令行 Agent 在后台自己接活、自己跟进到底；平时不烦你，遇到拿不准的事才发卡片找你拍板。", stars: 6000 });
  const es = cand("a/es", {}, { description: "Una herramienta de línea de comandos para gestionar contenedores en tu servidor" });
  const en = cand("a/en", {}, { description: "A command line tool for managing containers on your server" });
  const und = cand("a/und", {}, { description: "" });

  test("drops other languages with a reason, keeps English and undetermined", () => {
    const c = cfg({ filters: { spoken_languages: ["en"] } });
    expect(exclusionReason(zh, c, new Set())).toBe("written in Chinese (zh), not in filters.spoken_languages");
    expect(exclusionReason(es, c, new Set())).toBe("written in Spanish (es), not in filters.spoken_languages");
    expect(exclusionReason(en, c, new Set())).toBeNull();
    expect(exclusionReason(und, c, new Set())).toBeNull();
  });

  test("drop_undetected drops undetermined too", () => {
    const c = cfg({ filters: { spoken_languages: ["en"], drop_undetected: true } });
    expect(spokenReason(und, c)).toBe("language of the description not detected (filters.drop_undetected)");
    expect(spokenReason(en, c)).toBeNull();
  });

  test("empty or absent allows everything", () => {
    expect(spokenReason(zh, cfg())).toBeNull();
    expect(spokenReason(zh, cfg({ filters: { spoken_languages: [] } }))).toBeNull();
  });

  test("forage reports the dropped repos with their reason", async () => {
    const items = [
      rawRepo("x/chinese", { description: "让你的命令行 Agent 在后台自己接活、自己跟进到底", topics: ["hl7"], stargazers_count: 50, created_at: "2026-10-01T00:00:00Z" }),
      rawRepo("x/english", { description: "An HL7 parser for the command line", topics: ["hl7"], stargazers_count: 50, created_at: "2026-10-01T00:00:00Z" }),
    ];
    const api = fakeApi([[/^\/search\/repositories/, () => json({ items })]]);
    const gh = new GitHub({ fetch: api.fetch as any, cacheDir: null, sleep: async () => {}, now: () => NOW });
    const c = cfg({ seeds: [], keywords: [], topics: ["hl7"], filters: { spoken_languages: ["en"] }, limits: { kin_terms: 0, rising_per_query: 0, signals_top: 0 } });
    const res = await forage(c, gh, { now: NOW });
    expect(res.ranked.map((s) => s.candidate.repo.full_name)).toEqual(["x/english"]);
    expect(res.ranked[0].candidate.spoken?.lang).toBe("en");
    expect(res.excluded).toContainEqual({ full_name: "x/chinese", reason: "written in Chinese (zh), not in filters.spoken_languages" });
  });
});
