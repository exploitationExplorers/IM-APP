import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("H5 preview availability", () => {
  it("exposes H5 preview in the shared sidebar and router", () => {
    const shell = source("../src/client/components/AppShell.vue");
    const router = source("../src/client/router.ts");
    const view = source("../src/client/views/H5PreviewView.vue");
    const config = source("../src/client/h5-preview-config.ts");

    expect(shell).toContain('key: "h5-preview"');
    expect(shell).toContain('routeName: "h5-preview"');
    expect(router).toContain('path: "/h5-preview"');
    expect(router).toContain('name: "h5-preview"');
    expect(view).toContain("<iframe");
    expect(view).toContain("H5_PREVIEW_DEFAULT_URL");
    expect(config).toContain("https://www.ke58.com");
  });

  it("uses the workbench page layout for the H5 preview route", () => {
    const shell = source("../src/client/components/AppShell.vue");
    expect(shell).toContain('"h5-preview"');
    expect(shell.indexOf('"h5-preview"')).toBeLessThan(shell.indexOf("is-workbench-page"));
  });
});
