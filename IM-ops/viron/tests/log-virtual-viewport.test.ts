import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filterLogLineArray, tailLogLineArray } from "../src/client/log-filter.js";

const viewportSource = readFileSync(new URL("../src/client/components/LogVirtualViewport.vue", import.meta.url), "utf8");
const panelSource = readFileSync(new URL("../src/client/components/EnvironmentLogPanel.vue", import.meta.url), "utf8");

describe("log virtual viewport", () => {
  it("keeps row height in sync with the scroll geometry", () => {
    const lineHeight = viewportSource.match(/const LINE_HEIGHT = (\d+);/)?.[1];
    expect(lineHeight).toBeTruthy();
    expect(viewportSource).toContain(`height: ${lineHeight}px;`);
    expect(viewportSource).toContain(`line-height: ${lineHeight}px;`);
  });

  it("recycles row nodes instead of re-rendering a list every scroll frame", () => {
    expect(viewportSource).not.toContain("v-for");
    expect(viewportSource).toContain("index % poolSize");
    // 滚动必须同帧同步重绘，否则快速滚动会露出未绘制的空白带。
    const scrollHandler = viewportSource.match(/function handleScroll\(\) \{([\s\S]*?)\r?\n\}/)?.[1] ?? "";
    expect(scrollHandler).toContain("render();");
    expect(scrollHandler).not.toContain("scheduleRender");
  });

  it("drives repaints by version so a reused array reference still refreshes", () => {
    expect(panelSource).toContain(':version="displayVersion"');
    expect(viewportSource).toContain("() => [props.version, props.lines.length] as const");
  });

  it("passes line buffers through without copying when nothing is trimmed or filtered", () => {
    const lines = ["alpha", "beta"];
    expect(tailLogLineArray(lines, 10)).toBe(lines);
    expect(filterLogLineArray(lines, { keyword: "", caseSensitive: false, before: 0, after: 0 }).lines).toBe(lines);
  });

  it("keeps the log buffer out of the deep reactive graph", () => {
    expect(panelSource).toContain("markRaw<string[]>([])");
    expect(panelSource).toContain("viewer.linesVersion += 1");
  });
});
