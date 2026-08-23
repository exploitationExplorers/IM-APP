/**
 * H5 性能埋点：Core Web Vitals + IM 关键路径自定义指标。
 * 开发环境输出到 console；生产可通过 VITE_PERF_REPORT_URL 上报。
 */

type PerfMetric = {
  name: string
  value: number
  rating?: 'good' | 'needs-improvement' | 'poor'
  detail?: string
}

const REPORT_URL = import.meta.env.VITE_PERF_REPORT_URL as string | undefined
const ENABLED =
  typeof performance !== 'undefined' &&
  (import.meta.env.DEV || import.meta.env.VITE_PERF_REPORT_URL)

const pendingMarks = new Map<string, number>()

function logMetric(metric: PerfMetric) {
  if (import.meta.env.DEV) {
    console.info(`[perf] ${metric.name}: ${Math.round(metric.value)}ms${metric.detail ? ` (${metric.detail})` : ''}`)
  }
  if (REPORT_URL) {
    void fetch(REPORT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...metric, ts: Date.now(), path: location.pathname }),
      keepalive: true,
    }).catch(() => undefined)
  }
}

/** 标记阶段起点 */
export function perfMarkStart(name: string) {
  if (!ENABLED) return
  pendingMarks.set(name, performance.now())
  try {
    performance.mark(`${name}:start`)
  } catch {
    /* ignore */
  }
}

/** 标记阶段终点并记录耗时 */
export function perfMarkEnd(name: string, detail?: string) {
  if (!ENABLED) return
  const started = pendingMarks.get(name)
  if (started == null) return
  pendingMarks.delete(name)
  const duration = performance.now() - started
  try {
    performance.mark(`${name}:end`)
    performance.measure(name, `${name}:start`, `${name}:end`)
  } catch {
    /* ignore */
  }
  logMetric({ name, value: duration, detail })
}

/** 一次性记录数值型指标 */
export function perfRecord(name: string, value: number, detail?: string) {
  if (!ENABLED) return
  logMetric({ name, value, detail })
}

/** 初始化 Web Vitals 观测（仅 H5 开发 / 显式上报时） */
export function initPerfMonitoring() {
  if (!ENABLED || typeof PerformanceObserver === 'undefined') return

  let lcpLogged = false
  try {
    const lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries()
      const last = entries[entries.length - 1] as PerformanceEntry & { startTime: number }
      if (last && !lcpLogged) {
        lcpLogged = true
        const rating = last.startTime <= 2500 ? 'good' : last.startTime <= 4000 ? 'needs-improvement' : 'poor'
        logMetric({ name: 'LCP', value: last.startTime, rating })
      }
    })
    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true })
  } catch {
    /* 部分 WebView 不支持 */
  }

  let clsTotal = 0
  let clsLogged = false
  const reportCls = () => {
    if (clsLogged || clsTotal <= 0) return
    clsLogged = true
    const rating = clsTotal <= 0.1 ? 'good' : clsTotal <= 0.25 ? 'needs-improvement' : 'poor'
    logMetric({ name: 'CLS', value: clsTotal * 1000, rating, detail: 'x1000' })
  }
  try {
    const clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number }
        if (!e.hadRecentInput && e.value) clsTotal += e.value
      }
    })
    clsObserver.observe({ type: 'layout-shift', buffered: true })
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') reportCls()
      })
    }
    setTimeout(reportCls, 5000)
  } catch {
    /* ignore */
  }

  let fcpLogged = false
  try {
    const fcpObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint' && !fcpLogged) {
          fcpLogged = true
          logMetric({ name: 'FCP', value: entry.startTime })
        }
      }
    })
    fcpObserver.observe({ type: 'paint', buffered: true })
  } catch {
    /* ignore */
  }

  perfMarkStart('app:cold-start')
}

/** App 冷启动完成（bootstrap 结束） */
export function perfColdStartDone() {
  perfMarkEnd('app:cold-start', 'bootstrap')
}
