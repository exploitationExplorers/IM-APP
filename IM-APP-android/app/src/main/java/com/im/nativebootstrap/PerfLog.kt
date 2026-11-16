package com.im.nativebootstrap

/** Debug-only, privacy-safe phase marks. Never include tokens, IDs or message content. */
object PerfLog {
    private val started = System.nanoTime()

    fun mark(name: String, detail: String = "") {
        if (!BuildConfig.DEBUG) return
        val elapsed = (System.nanoTime() - started) / 1_000_000
        runCatching {
            android.util.Log.i("IMPerf", "+${elapsed}ms $name${if (detail.isBlank()) "" else " $detail"}")
        }
    }
}
