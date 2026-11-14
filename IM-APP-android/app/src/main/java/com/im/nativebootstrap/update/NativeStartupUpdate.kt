package com.im.nativebootstrap.update

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.LifecycleEventObserver
import com.im.nativebootstrap.business.NativeRelease
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

private val processUpdateCheckClaimed = AtomicBoolean(false)

/** 每次进程至多一次自动检查；失败静默，未配置时不读取旧 uni-app 渠道。 */
@Composable
fun NativeStartupUpdate() {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val scope = rememberCoroutineScope()
    var resumed by remember { mutableStateOf(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) }
    var release by remember { mutableStateOf<NativeRelease?>(null) }
    var ready by remember { mutableStateOf<File?>(null) }
    var downloading by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf("") }
    var downloadJob by remember { mutableStateOf<Job?>(null) }
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, _ -> resumed = lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(Unit) {
        if (!NativeUpdateClient.configured || !processUpdateCheckClaimed.compareAndSet(false, true)) return@LaunchedEffect
        delay(2500)
        val jobContext = currentCoroutineContext()
        try {
            release = withContext(Dispatchers.IO) {
                val local = context.packageManager.getPackageInfo(context.packageName, 0)
                NativeUpdateClient.check(context.applicationContext, NativeRelease.installedVersion(local)) { jobContext.ensureActive() }
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { /* 自动检查失败不打断登录、同步或聊天。 */ }
    }
    val candidate = release
    if (candidate != null && resumed) {
        fun dismiss() { downloadJob?.cancel(); downloadJob = null; downloading = false; release = null; ready = null; notice = "" }
        AlertDialog(
            onDismissRequest = { if (!downloading) dismiss() },
            title = { Text(if (downloading) "正在下载并核验" else "发现新版本") },
            text = {
                if (downloading) CircularProgressIndicator()
                else Text(listOf(candidate.versionName, candidate.changelog, notice).filter { it.isNotBlank() }.joinToString("\n"))
            },
            confirmButton = {
                TextButton(enabled = !downloading, onClick = {
                    val file = ready
                    if (file != null) {
                        runCatching { NativeRelease.install(context, file) }.fold(
                            { opened -> if (opened) dismiss() else notice = "允许安装后，请返回并点击安装更新。" },
                            { notice = "系统安装器暂不可用，请在关于我们中重试。" }
                        )
                    } else {
                        downloading = true; notice = ""
                        downloadJob = scope.launch {
                            val jobContext = currentCoroutineContext()
                            try {
                                ready = withContext(Dispatchers.IO) { NativeRelease.downloadCompatible(context.applicationContext, candidate) { jobContext.ensureActive() } }
                                jobContext.ensureActive()
                                // 下载结束仅显示安装按钮；用户回来时也需自己确认，避免后台拉起安装器。
                                notice = "已下载并完成校验，请点击安装更新。"
                            } catch (cancelled: CancellationException) { throw cancelled }
                            catch (_: Exception) { notice = "下载或校验失败，请稍后重试，或前往关于我们检查更新。" }
                            finally { downloading = false }
                        }
                    }
                }) { Text(if (ready != null) "安装更新" else "下载更新") }
            },
            dismissButton = { TextButton(onClick = ::dismiss) { Text(if (downloading) "取消下载" else "稍后") } }
        )
    }
}
