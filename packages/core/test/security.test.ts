import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  GitHub, GitHubError, cleanText, isSafeFullName, mdEscape, parseConfig, repoUrl, scoreCandidate,
  toJson, toMarkdown, toRepo, toText, ConfigError,
} from "../src/index.ts";
import { NOW, cfg, fakeApi, json, rawRepo } from "./helpers.ts";

const HOSTILE = 'Nice tool <script>alert(1)</script> [click](javascript:alert(1)) a|b ‮gnp.exe \u001b[31mred\u0007 <img src=x onerror=alert(1)>';

function hostileItem() {
  const repo = toRepo(rawRepo("evil/tool", {
    description: HOSTILE, html_url: "javascript:alert(1)", homepage: "javascript:alert(1)",
    topics: ["hl7", "x‮"], language: "<b>Go</b>",
  }))!;
  return scoreCandidate({ repo, sources: ["search"], via_topics: ["hl7"], via_keywords: [] }, cfg(), NOW);
}

describe("untrusted repo text", () => {
  test("markdown output is inert: no live HTML, links, table breaks or bidi", () => {
    const md = toMarkdown([hostileItem()], { date: "2026-11-20" });
    expect(md).not.toContain("<script>");
    expect(md).not.toContain("<img");
    expect(md).not.toContain("](javascript:");
    expect(md).not.toContain("‮");
    expect(md).not.toContain("\u001b");
    expect(md).toContain("&lt;script&gt;");
    expect(md).toContain("a\\|b");
    expect(md).toContain("\\[click\\]\\(javascript");
    // Each table row still has exactly 7 unescaped pipes (6 columns).
    const row = md.split("\n").find((l) => l.startsWith("| 1 |"))!;
    expect(row.replace(/\\\|/g, "").split("|").length - 1).toBe(7);
  });

  test("the only link is rebuilt from the validated name, never the API's html_url", () => {
    const item = hostileItem();
    expect(item.candidate.repo.html_url).toBe("https://github.com/evil/tool");
    const md = toMarkdown([item]);
    const links = [...md.matchAll(/\]\(([^)]*)\)|<(https?:[^>]*)>/g)].map((m) => m[1] ?? m[2]);
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toBe("https://github.com/evil/tool");
    expect(toJson([item])[0].url).toBe("https://github.com/evil/tool");
  });

  test("text output strips terminal escapes and bidi overrides", () => {
    const t = toText([hostileItem()]);
    expect(t).not.toMatch(/[\u0000-\u0009\u000B-\u001F‪-‮⁦-⁩]/);
  });

  test("repos with unsafe names are dropped at the door", () => {
    for (const bad of ["../etc/passwd", "a/b/c", "a/..", "evil/<x>", "a b/c", "", "x/‮exe"]) {
      expect(toRepo(rawRepo(bad))).toBeNull();
      expect(isSafeFullName(bad)).toBe(false);
      expect(repoUrl(bad)).toBeNull();
    }
    expect(toRepo(rawRepo("Good-Owner/repo.name_1"))!.full_name).toBe("Good-Owner/repo.name_1");
  });

  test("helpers: cleanText caps length, mdEscape escapes markdown and HTML", () => {
    expect(cleanText("x".repeat(500), 10)).toHaveLength(10);
    expect(mdEscape("*bold* _it_ `code` # h <b> & ~s~ !img")).toBe("\\*bold\\* \\_it\\_ \\`code\\` \\# h &lt;b&gt; &amp; \\~s\\~ \\!img");
  });
});

describe("cache paths", () => {
  test("files are named by a hash of the URL, so a hostile path cannot escape the cache dir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gitforage-cache-"));
    const gh = new GitHub({ fetch: fakeApi([[/.*/, () => json({ ok: 1 })]]).fetch, cacheDir: dir });
    await gh.get("/repos/../../../../tmp/evil");
    await gh.get("/repos/a/b%2F..%2F..%2Fx");
    const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(2);
    for (const f of files) {
      expect(relative(dir, join(dir, f)).startsWith("..")).toBe(false);
      expect(f).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{64}\.json$/);
    }
  });
});

describe("token handling", () => {
  const TOKEN = "ghp_SECRETSECRETSECRET123";

  test("an error body echoing the token is redacted, and no headers leak into errors", async () => {
    const api = fakeApi([[/.*/, () => json({ message: `bad credentials for ${TOKEN}` }, 401)]]);
    const gh = new GitHub({ token: TOKEN, fetch: api.fetch });
    const err = await gh.get("/repos/a/b").catch((e) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect(err.message).toContain("[REDACTED]");
    expect(err.message).not.toContain(TOKEN);
    expect(err.message).not.toMatch(/authorization|bearer/i);
  });

  test("log lines are redacted too", async () => {
    const logs: string[] = [];
    let n = 0;
    const api = fakeApi([[/.*/, () => (n++ ? json({}) : json({ message: "x" }, 429, { "retry-after": "1" }))]]);
    const gh = new GitHub({ token: TOKEN, fetch: api.fetch, sleep: async () => {}, log: (m) => logs.push(m) });
    await gh.get(`/repos/a/b?q=${TOKEN}`);
    expect(logs.length).toBe(1);
    expect(logs.join("\n")).not.toContain(TOKEN);
  });

  test("the cache never stores the token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gitforage-cache-"));
    const gh = new GitHub({ token: TOKEN, fetch: fakeApi([[/.*/, () => json({ ok: 1 })]]).fetch, cacheDir: dir });
    await gh.get("/repos/a/b");
    for (const f of readdirSync(dir, { recursive: true }).map(String).filter((x) => x.endsWith(".json"))) {
      expect(readFileSync(join(dir, f), "utf8")).not.toContain(TOKEN);
    }
  });
});

describe("resource caps", () => {
  test("oversized responses are refused (declared and streamed)", async () => {
    const big = JSON.stringify({ items: "x".repeat(5000) });
    const declared = fakeApi([[/.*/, () => json({ items: [] }, 200, { "content-length": "999999999" })]]);
    await expect(new GitHub({ fetch: declared.fetch, maxBodyBytes: 1000 }).get("/repos/a/b")).rejects.toThrow("response too large");
    const streamed = fakeApi([[/.*/, () => new Response(big, { status: 200 })]]);
    await expect(new GitHub({ fetch: streamed.fetch, maxBodyBytes: 1000 }).get("/repos/a/b")).rejects.toThrow("response too large");
  });

  test("hostile text fields are length-capped on intake", () => {
    const r = toRepo(rawRepo("a/b", { description: "y".repeat(100_000), topics: Array.from({ length: 500 }, (_, i) => `t${i}`) }))!;
    expect(r.description.length).toBeLessThanOrEqual(500);
    expect(r.topics.length).toBe(30);
  });
});

describe("safe YAML", () => {
  const problems = (text: string) => {
    try { parseConfig(text); } catch (e) { if (e instanceof ConfigError) return e.problems.join("\n"); throw e; }
    return "";
  };
  test("custom and language tags are refused", () => {
    expect(problems("topics: !!js/function 'function(){}'\n")).toContain("Unresolved tag");
    expect(problems("topics: !custom [hl7]\n")).toContain("Unresolved tag");
  });
  test("alias bombs are refused", () => {
    const bomb = "x: &a [1,1,1,1,1,1,1,1]\n" + Array.from({ length: 30 }, (_, i) => `y${i}: [*a,*a,*a,*a]`).join("\n") + "\ntopics: [hl7]\n";
    expect(problems(bomb)).toContain("Excessive alias count");
  });
  test("oversized files are refused", () => {
    expect(problems("topics: [hl7]\n#" + "x".repeat(300_000))).toContain("larger than");
  });
});
