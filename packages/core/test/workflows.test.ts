// Guards for the GitHub Actions workflows (this repo's and the template's). These
// encode the hardening rules so a later edit cannot quietly drop one.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { parseConfig, parseFeedback } from "../src/index.ts";
import { PLACEHOLDER_SHA, pinWorkflow } from "../../../scripts/pin-template.ts";

const root = join(import.meta.dir, "..", "..", "..");
const dirs = [join(root, ".github", "workflows"), join(root, "template", ".github", "workflows")];
const files = dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".yml")).map((f) => join(d, f)));
const load = (p: string) => ({ text: readFileSync(p, "utf8"), wf: parse(readFileSync(p, "utf8")) as any });
const steps = (wf: any) => Object.values(wf.jobs as Record<string, any>).flatMap((j) => j.steps ?? []);

describe("workflows", () => {
  test("there are workflows to check", () => {
    expect(files.map((f) => f.slice(root.length + 1)).sort()).toEqual([
      ".github/workflows/ci.yml", ".github/workflows/codeql.yml", "template/.github/workflows/feedback.yml", "template/.github/workflows/forage.yml",
    ]);
  });

  for (const f of files) {
    const name = f.slice(root.length + 1);
    const { text, wf } = load(f);

    test(`${name}: every action is pinned by a full commit SHA with a version comment`, () => {
      const uses = [...text.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)(.*)$/gm)];
      expect(uses.length).toBeGreaterThan(0);
      for (const [, ref, rest] of uses) {
        expect(ref).toMatch(/^[a-z0-9-]+\/[a-z0-9._/-]+@[0-9a-f]{40}$/);
        expect(rest).toMatch(/^\s+# v\d+\.\d+\.\d+$/);
      }
    });

    test(`${name}: no pull_request_target, and permissions are set per job`, () => {
      expect(text).not.toContain("pull_request_target");
      expect(wf.permissions).toBeDefined();
      for (const job of Object.values(wf.jobs as Record<string, any>)) {
        const perms = job.permissions ?? wf.permissions;
        expect(perms).toBeDefined();
        for (const v of Object.values(perms ?? {})) expect(["read", "write", "none"]).toContain(v as string);
      }
    });

    test(`${name}: no expression is interpolated into a run: script`, () => {
      for (const s of steps(wf)) if (typeof s.run === "string") expect(s.run).not.toContain("${{");
    });

    test(`${name}: checkouts do not keep credentials in .git/config`, () => {
      for (const s of steps(wf)) if (String(s.uses ?? "").startsWith("actions/checkout@")) expect(s.with?.["persist-credentials"]).toBe(false);
    });
  }

  test("template: forage can only write contents, deploy can only publish Pages", () => {
    const { wf } = load(join(root, "template", ".github", "workflows", "forage.yml"));
    expect(wf.permissions).toEqual({});
    expect(wf.jobs.forage.permissions).toEqual({ contents: "write" });
    expect(wf.jobs.deploy.permissions).toEqual({ pages: "write", "id-token": "write" });
    expect(Object.keys(wf.on).sort()).toEqual(["schedule", "workflow_dispatch"]);
    expect(wf.on.schedule[0].cron).toMatch(/ \* \* 0$/);
    expect(wf.concurrency).toEqual({ group: "gitforage-forage", "cancel-in-progress": false });
  });

  test("template: feedback runs on opened issues with contents and issues write only, and never puts issue text in env", () => {
    const { text, wf } = load(join(root, "template", ".github", "workflows", "feedback.yml"));
    expect(wf.on.issues).toEqual({ types: ["opened"] });
    expect(wf.permissions).toEqual({});
    expect(wf.jobs.feedback.permissions).toEqual({ contents: "write", issues: "write" });
    expect(text).not.toMatch(/github\.event\.issue\.(title|body)[^']*\}\}/);
    for (const s of steps(wf)) for (const v of Object.values(s.env ?? {})) expect(String(v)).not.toMatch(/github\.event\.(issue|comment)/);
  });

  test("template: both workflows pin the same gitforage commit; the release script replaces the placeholder", () => {
    const shas = ["forage.yml", "feedback.yml"].map((f) => load(join(root, "template", ".github", "workflows", f)).wf.env.GITFORAGE_SHA);
    // Both workflows run the same gitforage commit: the placeholder on main before a
    // release, or a real full SHA once scripts/pin-template.ts has pinned it.
    expect(shas[0]).toBe(shas[1]);
    expect(shas[0]).toMatch(/^[0-9a-f]{40}$/);
    const text = readFileSync(join(root, "template", ".github", "workflows", "forage.yml"), "utf8");
    const sha = "0123456789abcdef0123456789abcdef01234567";
    expect(parse(pinWorkflow(text, sha)).env.GITFORAGE_SHA).toBe(sha);
    expect(() => pinWorkflow(text, "main")).toThrow();
    expect(() => pinWorkflow(text, PLACEHOLDER_SHA)).toThrow();
    expect(() => pinWorkflow("name: x\n", sha)).toThrow();
  });
});

describe("template and demo files", () => {
  test("interests files are valid", () => {
    for (const f of ["template/interests.yml", "demo/interests.yml"]) expect(() => parseConfig(readFileSync(join(root, f), "utf8"), f)).not.toThrow();
  });

  test("the demo has exactly the five agreed topic groups and no stars_from", () => {
    const c = parseConfig(readFileSync(join(root, "demo", "interests.yml"), "utf8"));
    expect(c.topics).toEqual(["hl7", "fhir", "mirth", "dicom", "proxmox", "self-hosted", "docker", "home-assistant", "zigbee", "matter",
      "cli", "terminal", "devtools", "claude-code", "mcp", "ai-agents"]);
    expect(c.stars_from).toBeNull();
    expect(c.site.analytics).toEqual({ provider: "goatcounter", code: "gitforage" });
    expect(c.site.title).toBe("gitforage");
    expect(c.site.tag).toBe("beta");
  });

  test("the template's feedback.yml parses", () => {
    expect(parseFeedback(readFileSync(join(root, "template", "feedback.yml"), "utf8"))).toEqual({ marks: [], problems: [] });
  });
});
