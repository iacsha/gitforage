#!/usr/bin/env bun
// Release step: pin the template's workflows to a gitforage commit.
//
//   bun scripts/pin-template.ts <40-hex commit SHA>
//
// The template ships with a placeholder SHA, and its workflows refuse to run until it
// is replaced. Run this on the commit you release, so template users run exactly the
// code that was reviewed.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PLACEHOLDER_SHA = "0".repeat(40);
const LINE_RE = /^(\s*GITFORAGE_SHA:\s*)"[0-9a-f]{40}"\s*$/m;

/** Replace the pinned SHA in one workflow's text. Throws if the line is missing. */
export function pinWorkflow(text: string, sha: string): string {
  if (!/^[0-9a-f]{40}$/.test(sha) || sha === PLACEHOLDER_SHA) throw new Error("need a full 40-character lowercase commit SHA");
  if (!LINE_RE.test(text)) throw new Error('no GITFORAGE_SHA: "<sha>" line found');
  return text.replace(LINE_RE, (_m, lead) => `${lead}"${sha}"`);
}

if (import.meta.main) {
  const sha = process.argv[2] ?? "";
  const dir = join(import.meta.dir, "..", "template", ".github", "workflows");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".yml"))) {
    const p = join(dir, f);
    writeFileSync(p, pinWorkflow(readFileSync(p, "utf8"), sha));
    console.log(`pinned ${f} to ${sha}`);
  }
}
