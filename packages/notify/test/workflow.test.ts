// The template's Notify step: optional, after the state commit, secrets through env: only.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const wf = parse(readFileSync(join(import.meta.dir, "..", "..", "..", "template", ".github", "workflows", "forage.yml"), "utf8")) as any;

test("template: Notify runs after Commit state, cannot fail the run, and gets secrets only through env:", () => {
  const steps: any[] = wf.jobs.forage.steps;
  const names = steps.map((s) => s.name);
  const i = names.indexOf("Notify");
  expect(i).toBe(names.indexOf("Commit state") + 1);
  const step = steps[i];
  expect(step["continue-on-error"]).toBe(true);
  expect(step.run).not.toContain("${{");
  expect(step.run).toContain("cli.ts notify");
  expect(Object.keys(step.env).sort()).toEqual([
    "GITFORAGE_NTFY_TOKEN", "GITFORAGE_NTFY_TOPIC", "GITFORAGE_TELEGRAM_BOT_TOKEN", "GITFORAGE_TELEGRAM_CHAT_ID", "GITFORAGE_WEBHOOK_URL",
  ]);
  for (const [k, v] of Object.entries(step.env)) expect(v).toBe(`\${{ secrets.${k} }}`);
  // No other step sees a notify secret.
  for (const s of steps) if (s !== step) expect(JSON.stringify(s)).not.toContain("secrets.");
});
