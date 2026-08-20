<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { classifyLogSeverity, isLogStackContinuation, renderLogLineInnerHtml, type LogSeverity } from "../log-highlighting";

const LINE_HEIGHT = 20;
const PADDING_TOP = 16;
const PADDING_BOTTOM = 24;
// 一屏之外多渲染的行数，用来盖住一帧内滚过的距离，避免出现来不及绘制的空白带。
const OVERSCAN = 30;
const SEVERITY_LOOKBEHIND = 12;
const CACHE_LIMIT = 6000;
const FOLLOW_TAIL_SLACK = LINE_HEIGHT * 2;

const props = withDefaults(defineProps<{
  lines: readonly string[];
  version?: string | number;
  highlight?: boolean;
  keyword?: string;
  keywordCaseSensitive?: boolean;
  autoScroll?: boolean;
}>(), {
  version: "",
  highlight: false,
  keyword: "",
  keywordCaseSensitive: false,
  autoScroll: true,
});

interface RowSlot {
  element: HTMLElement;
  lineIndex: number;
  text: string;
  epoch: number;
  top: number;
  className: string;
}

const containerRef = ref<HTMLElement | null>(null);
const sizerRef = ref<HTMLElement | null>(null);

const severityCache = new Map<string, LogSeverity>();
const htmlCache = new Map<string, string>();
const slots: RowSlot[] = [];
let cacheSignature = "";
let epoch = 0;
let followTail = true;
let frameHandle = 0;
// 视口高度与内容总高都缓存下来，滚动回调里就不必再读 clientHeight / scrollHeight 触发强制重排。
let viewportHeight = 1;
let contentHeight = 0;
let resizeObserver: ResizeObserver | undefined;

function cachedSeverity(text: string): LogSeverity {
  const hit = severityCache.get(text);
  if (hit !== undefined) return hit;
  const severity = classifyLogSeverity(text);
  if (severityCache.size >= CACHE_LIMIT) severityCache.clear();
  severityCache.set(text, severity);
  return severity;
}

function cachedHtml(text: string): string {
  const hit = htmlCache.get(text);
  if (hit !== undefined) return hit;
  const html = renderLogLineInnerHtml(text, {
    semantic: props.highlight,
    keyword: props.keyword.trim(),
    keywordCaseSensitive: props.keywordCaseSensitive,
  });
  if (htmlCache.size >= CACHE_LIMIT) htmlCache.clear();
  htmlCache.set(text, html);
  return html;
}

// 堆栈续行继承上一条错误的等级，往前回看有限行数即可，避免整段重扫。
function severityAt(lines: readonly string[], index: number): LogSeverity {
  const text = lines[index] ?? "";
  const own = cachedSeverity(text);
  if (own !== "unknown") return own;
  if (!isLogStackContinuation(text)) return "unknown";
  for (let cursor = index - 1; cursor >= 0 && index - cursor <= SEVERITY_LOOKBEHIND; cursor -= 1) {
    const previous = lines[cursor] ?? "";
    const severity = cachedSeverity(previous);
    if (severity === "critical" || severity === "error") return severity;
    if (severity !== "unknown" || !isLogStackContinuation(previous)) break;
  }
  return "unknown";
}

function resizePool(size: number) {
  const sizer = sizerRef.value;
  if (!sizer) return;
  while (slots.length > size) slots.pop()?.element.remove();
  while (slots.length < size) {
    const element = document.createElement("div");
    element.className = "log-line";
    sizer.appendChild(element);
    slots.push({ element, lineIndex: -1, text: "\u0000", epoch: -1, top: -1, className: "log-line" });
  }
}

function syncSizerHeight(total: number) {
  const sizer = sizerRef.value;
  contentHeight = total ? PADDING_TOP + total * LINE_HEIGHT + PADDING_BOTTOM : 0;
  if (sizer) sizer.style.height = `${contentHeight}px`;
}

// 直接写 DOM 而不经过 Vue 的 diff：行节点按行号取模复用，只有内容真正变化的槽位才会被改写。
function render() {
  frameHandle = 0;
  const container = containerRef.value;
  if (!container || !sizerRef.value) return;

  const lines = props.lines;
  const total = lines.length;
  syncSizerHeight(total);

  const capacity = Math.ceil(viewportHeight / LINE_HEIGHT) + OVERSCAN * 2 + 1;
  const poolSize = Math.min(total, capacity);
  if (poolSize !== slots.length) resizePool(poolSize);
  if (!slots.length) return;

  // 收紧起点，保证可见区间正好铺满整个节点池，不留下未刷新的残留行。
  const estimated = Math.floor((container.scrollTop - PADDING_TOP) / LINE_HEIGHT) - OVERSCAN;
  const first = Math.max(0, Math.min(estimated, total - poolSize));

  const signature = `${props.highlight ? "1" : "0"}|${props.keywordCaseSensitive ? "1" : "0"}|${props.keyword.trim()}`;
  if (signature !== cacheSignature) {
    cacheSignature = signature;
    htmlCache.clear();
    severityCache.clear();
    epoch += 1;
  }

  const decorated = props.highlight || Boolean(props.keyword.trim());
  for (let index = first; index < first + poolSize; index += 1) {
    const slot = slots[index % poolSize]!;
    const text = lines[index] ?? "";
    if (slot.lineIndex === index && slot.text === text && slot.epoch === epoch) continue;

    const top = PADDING_TOP + index * LINE_HEIGHT;
    if (slot.top !== top) {
      slot.element.style.transform = `translateY(${top}px)`;
      slot.top = top;
    }
    const severity = props.highlight ? severityAt(lines, index) : "unknown";
    const className = severity === "unknown" ? "log-line" : `log-line log-line--${severity}`;
    if (slot.className !== className) {
      slot.element.className = className;
      slot.className = className;
    }
    if (decorated) slot.element.innerHTML = cachedHtml(text);
    else slot.element.textContent = text || "\u200b";

    slot.lineIndex = index;
    slot.text = text;
    slot.epoch = epoch;
  }
}

function scheduleRender() {
  if (frameHandle) return;
  frameHandle = requestAnimationFrame(render);
}

function handleScroll() {
  const container = containerRef.value;
  if (!container) return;
  followTail = contentHeight - container.scrollTop - viewportHeight <= FOLLOW_TAIL_SLACK;
  // 同帧同步重绘，滚动手势不会越过尚未绘制的区域。
  if (frameHandle) {
    cancelAnimationFrame(frameHandle);
    frameHandle = 0;
  }
  render();
}

function scrollToBottom(force = false) {
  const container = containerRef.value;
  if (!container) return;
  if (!force && (!props.autoScroll || !followTail)) return;
  syncSizerHeight(props.lines.length);
  container.scrollTop = Math.max(0, contentHeight - viewportHeight);
  followTail = true;
  render();
}

watch(
  () => [props.version, props.lines.length] as const,
  ([, nextLength], previous) => {
    if (nextLength < (previous?.[1] ?? 0)) scrollToBottom(true);
    else if (props.autoScroll && followTail) scrollToBottom(false);
    else render();
  },
);

watch(
  () => [props.keyword, props.keywordCaseSensitive, props.highlight] as const,
  () => render(),
);

onMounted(() => {
  const container = containerRef.value;
  if (!container) return;
  viewportHeight = container.clientHeight || 1;
  resizeObserver = new ResizeObserver((entries) => {
    const height = entries[0]?.contentRect.height ?? container.clientHeight;
    if (height > 0) viewportHeight = height;
    scheduleRender();
  });
  resizeObserver.observe(container);
  render();
  scrollToBottom(true);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  if (frameHandle) cancelAnimationFrame(frameHandle);
});

defineExpose({ scrollToBottom });
</script>

<template>
  <div ref="containerRef" class="log-virtual-viewport" @scroll.passive="handleScroll">
    <div ref="sizerRef" class="log-virtual-viewport__sizer"></div>
  </div>
</template>

<style scoped>
.log-virtual-viewport {
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: auto;
  overflow-anchor: none;
  contain: content;
}

.log-virtual-viewport__sizer {
  position: relative;
  min-width: 100%;
  color: #c6d7d3;
  font-family: var(--font-console);
  font-size: var(--font-console-size);
  line-height: 20px;
  tab-size: 4;
}

.log-virtual-viewport__sizer :deep(.log-line) {
  position: absolute;
  left: 0;
  top: 0;
  width: max-content;
  min-width: 100%;
  height: 20px;
  padding: 0 20px;
  box-sizing: border-box;
  white-space: pre;
  contain: layout style;
}
</style>
