import { describe, expect, test } from "bun:test";
import { parseConfig } from "@gitforage/core";
import { renderSite } from "../src/index.ts";

const base = "topics: [cli]\nsite:\n  title: gitforage\n";

describe("site.tag", () => {
  test("is shown beside the title on every page", () => {
    const files = renderSite(parseConfig(`${base}  tag: beta\n`), []);
    for (const [path, body] of files) if (path.endsWith(".html")) expect(body).toContain('<span class="brand-tag">beta</span>');
  });
  test("is left out when unset", () => {
    const files = renderSite(parseConfig(base), []);
    expect(files.get("index.html")).not.toContain("brand-tag");
  });
  test("rejects anything but a short lowercase label", () => {
    for (const bad of ['"<b>beta</b>"', "BETA", '"a very long tag here"', '"x\\u202e"']) {
      expect(() => parseConfig(`${base}  tag: ${bad}\n`)).toThrow();
    }
  });
});
