import { describe, expect, it } from "vitest";
import { ADMIN_PREVIEW_DEFAULT_URL, H5_PREVIEW_DEFAULT_URL, previewFrameSrcDirectives } from "../src/shared/preview-embed";

describe("preview embed CSP helpers", () => {
  it("exposes H5 and admin preview origins for frame-src", () => {
    const directives = previewFrameSrcDirectives();
    expect(directives).toContain("'self'");
    expect(directives).toContain(new URL(H5_PREVIEW_DEFAULT_URL).origin);
    expect(directives).toContain(new URL(ADMIN_PREVIEW_DEFAULT_URL).origin);
  });
});
