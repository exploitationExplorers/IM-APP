package com.im.nativebootstrap

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalConfiguration
import androidx.lifecycle.ViewModelProvider
import com.google.gson.JsonElement
import com.google.gson.JsonParser
import com.im.nativebootstrap.business.BusinessController
import com.im.nativebootstrap.business.ContactsHome
import com.im.nativebootstrap.business.MineHome
import com.im.nativebootstrap.business.NativeBusinessPage
import com.im.nativebootstrap.chat.*
import com.im.nativebootstrap.media.MediaLoader
import kotlinx.coroutines.*
import java.io.File
import java.security.MessageDigest

/** 只在测试 APK 注入合成只读资料；不改变产品入口，不申请 Token、不调用生产接口。 */
class FullParityInstrumentation : Instrumentation() {
    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }
    override fun onStart() {
        val result = Bundle()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        var activity: MainActivity? = null
        val files = mutableListOf<File>()
        try {
            SecureSessionStoreInstrumentation.verify(targetContext)
            result.putString("secureSession", "passed: AndroidKeyStore encryption, recreation, replace, tamper rejected and preserved, clear")
            val url = "https://media-fixture.invalid/native-parity.png"
            val key = MessageDigest.getInstance("SHA-256").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }
            val cached = File(targetContext.cacheDir, "media/$key").apply { parentFile!!.mkdirs() }
            val image = Bitmap.createBitmap(1200, 900, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(image); canvas.drawColor(android.graphics.Color.rgb(27, 114, 226))
            val paint = Paint().apply { color = android.graphics.Color.rgb(255, 196, 54) }
            canvas.drawCircle(600f, 450f, 260f, paint)
            cached.outputStream().use { check(image.compress(Bitmap.CompressFormat.PNG, 100, it)) }; image.recycle()
            com.im.nativebootstrap.media.MediaFixture.seed(targetContext,url,cached.readBytes(),"image/png")
            files += cached
            val decoded = MediaLoader.bitmap(targetContext, url, 128)
            check(decoded.width in 1..256 && decoded.height in 1..256) { "Downsampling failed" }
            check(MediaLoader.bitmap(targetContext, url, 128) === decoded) { "Memory cache missed" }
            val preview = MediaLoader.bitmap(targetContext, url, 960)
            check(preview.width > decoded.width) { "Preview reused avatar resolution" }
            val corruptURL = "https://media-fixture.invalid/not-an-image.png"
            val corruptKey = MessageDigest.getInstance("SHA-256").digest(corruptURL.toByteArray()).joinToString("") { "%02x".format(it) }
            val corrupt = File(targetContext.cacheDir, "media/$corruptKey").apply { writeText("<html>expired media fixture</html>") }
            files += corrupt
            com.im.nativebootstrap.media.MediaFixture.seed(targetContext,corruptURL,corrupt.readBytes(),"text/html")
            check(runCatching { MediaLoader.bitmap(targetContext, corruptURL, 128) }.isFailure) { "HTML response decoded as an image" }
            check(!com.im.nativebootstrap.media.MediaFixture.exists(targetContext,corruptURL)) { "Invalid image permanently poisoned the disk cache" }
            val fixture = """{"id":"fixture-user","nickname":"本地图片验证","publicId":"fixture123","avatar":"$url","bio":"合成数据，不代表真实账号","hasPassword":true,"phoneMasked":"仅本地合成","countryCode":"+86"}"""
            val contact = """{"id":"fixture-friend","nickname":"图片联系人","avatar":"$url","publicId":"friend123","friendSince":"2026-10-01T08:00:00Z","lastSeenAt":"2026-11-13T08:00:00Z","commonGroups":[],"tags":[{"id":"fixture-tag","name":"本地标签"}]}"""
            val friendDetail = JsonParser.parseString(contact).asJsonObject.apply { addProperty("remark", "本地好友备注") }.toString()
            val group = """{"id":"fixture-group","name":"图片测试群","avatar":"$url","status":"active"}"""
            val controller = BusinessController(scope, { method, path, _, _ ->
                check(method == "GET" || path == "/friend-requests/sync") { "Unexpected mutation" }
                val raw = when(path) {
                    "/me" -> fixture
                    "/contacts" -> """{"items":[$contact],"total":1,"hasMore":false}"""
                    "/groups" -> "[$group]"
                    "/contacts/fixture-friend" -> friendDetail
                    "/groups/detail" -> """{"id":"fixture-group","name":"图片测试群","avatar":"$url","role":"owner","myRole":"owner","publicId":"qun_fixture","memberCount":2,"joinMode":"approval","permissions":{"canEditAnnouncement":true,"canEditProfile":true,"canManageMembers":true}}"""
                    "/group-members" -> """{"items":[$contact,$fixture],"hasMore":false}"""
                    "/groups/fixture-group/join-requests" -> "[]"
                    "/me/qrcode" -> """{"payload":"im://user/local-fixture-only","expiresAt":"","user":$fixture}"""
                    "/group-announcements" -> """{"items":[{"id":"fixture-announcement","content":"本地公告图片验证","images":["$url"],"publisherName":"本地合成","createdAt":"2026-11-13T00:00:00Z"}],"hasMore":false}"""
                    "/friend-requests/sync" -> """{"pending":[],"recent":[]}"""
                    "/me/privacy-settings" -> """{"requireFriendApproval":true,"requireGroupApproval":true}"""
                    else -> error("Unexpected fixture request")
                }
                JsonParser.parseString(raw)
            }, { _, _, _, _ -> error("Chat network is disabled in fixture") }, {})
            activity = startActivitySync(Intent(targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
            val screen = activity
            result.putString("animatedMedia", com.im.nativebootstrap.media.AnimatedMediaSmoke.verify(this, screen))
            lateinit var model: BootstrapViewModel
            runOnMainSync { model = ViewModelProvider(screen)[BootstrapViewModel::class.java] }
            fun render(name: String, required: List<String>, content: @Composable () -> Unit) {
                runOnMainSync {
                    screen.setContent { MaterialTheme {
                        Column(Modifier.fillMaxSize().statusBarsPadding()) {
                            Text("本地合成数据验证 · 不联网", color = Color.Gray, modifier = Modifier.padding(4.dp))
                            Box(Modifier.weight(1f)) { content() }
                        }
                    } }
                }
                var visible = ""
                repeat(30) {
                    waitForIdleSync()
                    visible = collect(uiAutomation.rootInActiveWindow)
                    if (required.all(visible::contains) && !visible.contains("加载中")) return@repeat
                    Thread.sleep(100)
                }
                check(required.all(visible::contains)) { "Missing rendered content: $name" }
                check(!visible.contains("加载失败")) { "Cached image was not displayed: $name" }
                val screenshot = uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
                val destination = File(targetContext.cacheDir, "full-parity-$name.png")
                destination.outputStream().use { check(screenshot.compress(Bitmap.CompressFormat.PNG, 100, it)) }
                screenshot.recycle()
            }
            render("mine", listOf("个人中心", "本地图片验证", "我的收藏", "通知设置", "聊天设置", "隐私", "安全", "通用", "通讯录", "聊天", "我的")) {
                UniHome(BootstrapState(authenticated = true), model, UniScale(LocalConfiguration.current.screenWidthDp.toFloat()), "mine", {}, {}, businessController = controller)
            }
            render("contacts", listOf("通讯录", "新的朋友", "标签", "群聊天", "图片联系人", "图片测试群", "我的")) {
                UniHome(BootstrapState(authenticated = true), model, UniScale(LocalConfiguration.current.screenWidthDp.toFloat()), "contacts", {}, {}, businessController = controller)
            }
            for ((page, required) in listOf(
                "notifications" to listOf("通知设置", "消息免打扰", "新消息通知", "应用打开时"),
                "chat-settings" to listOf("聊天设置", "群发助手", "我的表情", "清除聊天记录"),
                "privacy" to listOf("隐私", "加我为好友需验证", "黑名单"),
                "security" to listOf("安全", "修改密码", "旧密码", "下一步"),
                "general" to listOf("通用", "切换语言", "显示模式", "意见反馈"),
                "profile" to listOf("个人资料", "昵称", "个性签名", "聊天号"),
                "about" to listOf("关于我们", "易可聊", "检查更新", "用户协议"),
                "qrcode" to listOf("二维码", "保存", "分享", "本地图片验证"),
                "announcements" to listOf("群公告", "本地公告图片验证")
            )) {
                runOnMainSync { controller.open(page) }
                render(page, required) { NativeBusinessPage(controller, model, {}) }
                check(controller.state.value.error == null) { "Synthetic business page failed: $page" }
            }
            for ((page, id, required) in listOf(
                Triple("friend", "fixture-friend", listOf("好友详情", "本地好友备注", "聊天号", "本地标签")),
                Triple("group", "fixture-group", listOf("群组详情", "群组成员", "群组管理", "入群申请"))
            )) {
                runOnMainSync { controller.open(page, id) }
                render(page, required) { NativeBusinessPage(controller, model, {}) }
                check(controller.state.value.error == null) { "Synthetic details page failed: $page" }
            }
            val target = ChatTarget("si_fixture", 1, userId = "fixture-friend")
            val conversation = ChatConversation(target, "图片测试会话", "", 1, avatar = url)
            val picture = """{"contentType":102,"senderFaceUrl":"$url","pictureElem":{"sourcePicture":{"url":"$url","width":1200,"height":900},"snapshotPicture":{"url":"$url"}}}"""
            val state = ChatState(ready = true, loggedIn = true, connection = ConnectionState.CONNECTED, active = conversation, historyEnd = true,
                messages = listOf(ChatMessage("fixture-image", "[图片]", false, System.currentTimeMillis(), seq = 1, serialized = picture)))
            val callbacks = NativeChatCallbacks({}, {}, { _, _, done -> done(false) }, { _, done -> done(false) }, {}, { _, _, done -> done(Result.failure(IllegalStateException())) }, { _, _, done -> done(Result.failure(IllegalStateException())) }, {})
            render("chat-image", listOf("图片测试会话", "图片")) { NativeChatRoom(state, callbacks) }
            result.putString("fullParity", "passed: bitmap decode/downsampling/cache plus synthetic mine/contacts/chat image rendering")
            result.putString("scope", "Synthetic local fixtures only; not production interoperability or pixel equivalence")
            finish(Activity.RESULT_OK, result)
        } catch (error: Throwable) {
            result.putString("fullParity", "failed: " + error.javaClass.simpleName + ": " + error.message)
            finish(Activity.RESULT_CANCELED, result)
        } finally {
            scope.cancel()
            activity?.let { runOnMainSync { it.finish() } }
            files.forEach { it.delete() }
        }
    }
    private fun collect(node: AccessibilityNodeInfo?): String {
        if (node == null) return ""
        return buildString {
            append(node.text ?: ""); append(' '); append(node.contentDescription ?: "")
            for (index in 0 until node.childCount) { append(' '); append(collect(node.getChild(index))) }
        }
    }
}
