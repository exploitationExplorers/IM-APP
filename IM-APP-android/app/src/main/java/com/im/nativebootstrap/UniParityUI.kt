package com.im.nativebootstrap

import android.app.Activity
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.ClickableText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.im.nativebootstrap.data.RuntimeEndpoints
import kotlin.math.abs

private val Primary = Color(0xFF0A2FC2)
private val Ink = Color(0xFF212121)
private val Hint = Color(0xFF636E86)
private val ScreenGray = Color(0xFFE6E8EE)

/** uni-app rpx 只按视口宽度缩放；auth-modern.scss 的 px 直接用 dp。 */
private class UniScale(private val width: Float) {
    fun dp(rpx: Int): Dp = (width * rpx / 750f).dp
    fun text(rpx: Int) = (width * rpx / 750f).sp
}
private fun cssText(size: Int, color: Color = Ink, weight: FontWeight = FontWeight.Normal) =
    TextStyle(fontSize = size.sp, color = color, fontWeight = weight, platformStyle = PlatformTextStyle(includeFontPadding = false))

@Composable
fun UniParityApp(model: BootstrapViewModel = viewModel()) {
    val state by model.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scale = UniScale(LocalConfiguration.current.screenWidthDp.toFloat())
    var debugOpen by remember { mutableStateOf(false) }
    var endpoint by remember { mutableStateOf(RuntimeEndpoints.DEFAULT_API_BASE_URL) }
    var tab by remember { mutableStateOf("chat") }
    var legal by remember { mutableStateOf<String?>(null) }
    val login = !state.sample && !state.authenticated
    SideEffect {
        (context as? Activity)?.let { WindowInsetsControllerCompat(it.window, it.window.decorView).isAppearanceLightStatusBars = !login }
    }
    BackHandler(enabled = debugOpen || legal != null || state.sample || state.authenticated || state.busy) {
        when {
            legal != null -> legal = null
            debugOpen -> debugOpen = false
            state.chatOpen -> model.closeChat()
            else -> model.logout()
        }
    }
    val toast: (String) -> Unit = { Toast.makeText(context, it, Toast.LENGTH_SHORT).show() }
    when {
        login -> UniLogin(state, endpoint, model, onDebug = { debugOpen = true }, onLegal = { legal = it }, toast = toast)
        state.sample && state.chatOpen -> UniChat(state, model, scale, toast)
        else -> UniHome(state, model, scale, tab, { tab = it }, toast)
    }
    if (debugOpen) AlertDialog(
        onDismissRequest = { debugOpen = false },
        title = { Text("本地开发设置") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("默认连接现有服务。可在此覆盖 HTTPS 服务地址；留空恢复默认。本地样例只使用内存，不联网、不发送真实消息，退出后清除。", style = cssText(13, Hint))
                PlainField(endpoint, { endpoint = it }, "HTTPS 服务地址 /api/v1", Modifier.fillMaxWidth().height(52.dp), textSize = 13)
                if (state.busy) TextButton(onClick = model::logout) { Text("取消认证请求") }
                Text(state.notice, style = cssText(12, Hint))
            }
        },
        confirmButton = { TextButton(onClick = { debugOpen = false; tab = "chat"; model.startSample() }) { Text("进入本地样例") } },
        dismissButton = { TextButton(onClick = { debugOpen = false }) { Text("保存并关闭") } },
    )
    legal?.let { LegalSheet(it, { legal = null }) }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun UniLogin(state: BootstrapState, endpoint: String, model: BootstrapViewModel, onDebug: () -> Unit, onLegal: (String) -> Unit, toast: (String) -> Unit) {
    var phone by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var country by remember { mutableStateOf("+86") }
    var countryOpen by remember { mutableStateOf(false) }
    var reveal by remember { mutableStateOf(false) }
    var agreed by remember { mutableStateOf(false) }
    val small = LocalConfiguration.current.screenHeightDp <= 650
    val scale = UniScale(LocalConfiguration.current.screenWidthDp.toFloat())
    val density = LocalDensity.current
    Box(Modifier.fillMaxSize().drawBehind {
        // CSS linear-gradient(326deg, #2f9de2 6.61%, #1c41c7 35.26%, #0c1b54 93.13%).
        val dx = -0.559193f
        val dy = -0.829038f
        val extent = (abs(size.width * dx) + abs(size.height * dy)) / 2f
        val center = Offset(size.width / 2f, size.height / 2f)
        drawRect(Brush.linearGradient(
            colorStops = arrayOf(0.0661f to Color(0xFF2F9DE2), 0.3526f to Color(0xFF1C41C7), 0.9313f to Color(0xFF0C1B54)),
            start = center - Offset(dx * extent, dy * extent), end = center + Offset(dx * extent, dy * extent),
        ))
    }) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(Modifier.height(if (small) 28.dp else 64.dp))
            Image(painterResource(R.drawable.uni_logo), "易可聊", Modifier.size(if (small) 44.dp else 56.dp).clip(RoundedCornerShape(if (small) 12.dp else 15.dp)).combinedClickable(onClick = {}, onLongClick = onDebug))
            Spacer(Modifier.height(if (small) 24.dp else 32.dp))
            Column(Modifier.widthIn(max = 400.dp).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("登录易可聊", style = cssText(26, Color.White, FontWeight.SemiBold), lineHeight = 36.sp)
                Spacer(Modifier.height(8.dp))
                Text("使用手机号和密码登录", style = cssText(14, Color(0xFFE2E8F0)), lineHeight = 22.sp)
                Spacer(Modifier.height(if (small) 24.dp else 32.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(Modifier.width(78.dp).height(52.dp)) {
                        Row(Modifier.fillMaxSize().clip(RoundedCornerShape(12.dp)).background(Color(0xFFF8FAFC)).border(1.dp, Color(0xFFE4E7EC), RoundedCornerShape(12.dp)).clickable { countryOpen = !countryOpen }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
                            Text(country, style = cssText(15, Ink, FontWeight.Normal))
                            Text("▾", Modifier.padding(start = 4.dp), style = cssText(11, Color(0xFF8A8F9C)))
                        }
                        if (countryOpen) Popup(alignment = Alignment.TopStart, offset = IntOffset(0, with(density) { (52.dp + scale.dp(8)).roundToPx() }), onDismissRequest = { countryOpen = false }, properties = PopupProperties(focusable = true)) {
                            Column(Modifier.width(scale.dp(280)).heightIn(max = scale.dp(480)).shadow(scale.dp(16), RoundedCornerShape(scale.dp(12))).clip(RoundedCornerShape(scale.dp(12))).background(Color.White).verticalScroll(rememberScrollState())) {
                                listOf("中国" to "+86", "中国香港" to "+852", "美国" to "+1", "新加坡" to "+65", "马来西亚" to "+60").forEach { (name, code) ->
                                    Column {
                                        Row(Modifier.fillMaxWidth().clickable { country = code; countryOpen = false }.padding(horizontal = scale.dp(24), vertical = scale.dp(20)), horizontalArrangement = Arrangement.SpaceBetween) {
                                            Text(name, fontSize = scale.text(26), color = if (country == code) Primary else Ink)
                                            Text(code, fontSize = scale.text(26), color = Color(0xFF8A8F9C))
                                        }
                                        Box(Modifier.fillMaxWidth().height(scale.dp(1)).background(Color(0xFFF0F0F0)))
                                    }
                                }
                            }
                        }
                    }
                    PlainField(phone, { phone = it.filter(Char::isDigit).take(15) }, when (country) { "+852", "+65" -> "请输入 8 位手机号码"; "+1" -> "请输入 10 位手机号码"; else -> "请输入手机号码" }, Modifier.weight(1f).height(52.dp), keyboard = KeyboardType.Phone, enabled = !state.busy)
                }
                Spacer(Modifier.height(16.dp))
                PlainField(password, { password = it }, "请输入密码", Modifier.fillMaxWidth().height(52.dp), enabled = !state.busy, keyboard = KeyboardType.Password, transformation = if (reveal) VisualTransformation.None else PasswordVisualTransformation(), trailing = {
                    Box(Modifier.width(44.dp).fillMaxHeight().clickable { reveal = !reveal }, contentAlignment = Alignment.Center) {
                        Image(painterResource(if (reveal) R.drawable.uni_auth_eye else R.drawable.uni_auth_eye_off), if (reveal) "隐藏密码" else "显示密码", Modifier.size(22.dp))
                    }
                })
                Spacer(Modifier.height(16.dp))
                Box(Modifier.fillMaxWidth().height(24.dp), contentAlignment = Alignment.CenterEnd) {
                    Text("忘记密码", Modifier.clickable { toast("找回密码页面尚未接入，本轮仅还原登录。") }, style = cssText(13, Color.White), lineHeight = 24.sp)
                }
                Row(Modifier.fillMaxWidth().height(62.dp).padding(vertical = 20.dp), verticalAlignment = Alignment.Top) {
                    Box(Modifier.requiredSize(24.dp).offset(x = (-4).dp).clickable(role = Role.Checkbox) { agreed = !agreed }.semantics { contentDescription = "同意用户协议和隐私政策" }, contentAlignment = Alignment.Center) {
                        Box(Modifier.size(16.dp).clip(CircleShape).background(if (agreed) Color.White else Color.Transparent).border(1.dp, Color(0xFFD1D9EC), CircleShape), contentAlignment = Alignment.Center) {
                            if (agreed) Text("✓", style = cssText(12, Primary, FontWeight.Bold))
                        }
                    }
                    LegalCopy({ agreed = !agreed }, onLegal)
                }
                Box(Modifier.fillMaxWidth().height(50.dp).clip(RoundedCornerShape(12.dp)).background(Color.White).clickable(enabled = !state.busy) {
                    when {
                        !agreed -> toast("请先阅读并同意用户协议与隐私政策")
                        !validPhone(country, phone) -> toast("请输入正确的手机号码")
                        password.isEmpty() -> toast("请输入密码")
                        else -> { model.login(endpoint.ifBlank { RuntimeEndpoints.DEFAULT_API_BASE_URL }, country, phone, password, true); password = "" }
                    }
                }, contentAlignment = Alignment.Center) {
                    Text(if (state.busy) "登录中…" else "登录", style = cssText(16, Primary, FontWeight.Medium))
                }
                if (state.notice.isNotBlank() && !state.busy) Text(state.notice, Modifier.padding(top = 12.dp), style = cssText(12, Color(0xFFE2E8F0)))
                Spacer(Modifier.height(28.dp))
                Text("立即注册", Modifier.clickable { toast("注册页面尚未接入，本轮仅还原登录。") }, style = cssText(14, Color.White), lineHeight = 24.sp)
                Spacer(Modifier.height(32.dp))
            }
        }
    }
}

@Composable
private fun LegalCopy(toggle: () -> Unit, legal: (String) -> Unit) {
    val copy = remember {
        buildAnnotatedString {
            append("我已阅读并同意 ")
            pushStringAnnotation("legal", "agreement")
            withStyle(SpanStyle(color = Color.White)) { append("《用户协议》") }
            pop()
            append(" 和 ")
            pushStringAnnotation("legal", "privacy")
            withStyle(SpanStyle(color = Color.White)) { append("《隐私政策》") }
            pop()
        }
    }
    ClickableText(copy, Modifier.padding(start = 2.dp), style = cssText(12, Color(0xFFE2E8F0)).copy(lineHeight = 22.sp)) { offset ->
        val target = copy.getStringAnnotations("legal", offset, offset).firstOrNull()
        if (target == null) toggle() else legal(target.item)
    }
}

private fun validPhone(country: String, phone: String): Boolean = when (country) {
    "+86" -> Regex("1\\d{10}").matches(phone)
    "+852", "+65" -> Regex("\\d{8}").matches(phone)
    "+1" -> Regex("\\d{10}").matches(phone)
    "+60" -> Regex("\\d{9,10}").matches(phone)
    else -> false
}

@Composable
private fun PlainField(value: String, onValue: (String) -> Unit, placeholder: String, modifier: Modifier, textSize: Int = 15, keyboard: KeyboardType = KeyboardType.Text, enabled: Boolean = true, transformation: VisualTransformation = VisualTransformation.None, trailing: (@Composable () -> Unit)? = null) {
    Row(modifier.clip(RoundedCornerShape(12.dp)).background(Color(0xFFF8FAFC)).border(1.dp, Color(0xFFE4E7EC), RoundedCornerShape(12.dp)).padding(start = 16.dp, end = if (trailing == null) 16.dp else 4.dp), verticalAlignment = Alignment.CenterVertically) {
        BasicTextField(value, onValue, Modifier.weight(1f), enabled = enabled, singleLine = true, textStyle = cssText(textSize), visualTransformation = transformation, keyboardOptions = KeyboardOptions(keyboardType = keyboard), cursorBrush = SolidColor(Primary), decorationBox = { inner -> Box { if (value.isEmpty()) Text(placeholder, style = cssText(textSize, Hint)); inner() } })
        trailing?.invoke()
    }
}

@Composable
private fun LegalSheet(kind: String, dismiss: () -> Unit) {
    val context = LocalContext.current
    val title = if (kind == "agreement") "用户协议" else "隐私政策"
    Dialog(onDismissRequest = dismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(Color.White).systemBarsPadding()) {
            Row(Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("‹", Modifier.width(40.dp).clickable(onClick = dismiss), style = cssText(28)); Text(title, style = cssText(17, Ink, FontWeight.Bold))
            }
            AndroidView(factory = { WebView(it).apply {
                settings.javaScriptEnabled = false
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                val html = context.assets.open("legal/$kind.html").bufferedReader().use { it.readText() }
                loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
            } }, modifier = Modifier.fillMaxSize())
        }
    }
}

@Composable
private fun UniHome(state: BootstrapState, model: BootstrapViewModel, s: UniScale, tab: String, changeTab: (String) -> Unit, toast: (String) -> Unit) {
    Column(Modifier.fillMaxSize().background(Color.White).statusBarsPadding().navigationBarsPadding()) {
        if (state.sample) SampleStrip(s) else state.profileWarning?.let { Text(it, Modifier.fillMaxWidth().background(Color(0xFFF3F4F7)).padding(horizontal = s.dp(24), vertical = s.dp(12)), fontSize = s.text(24), color = Hint) }
        Row(Modifier.fillMaxWidth().height(s.dp(96)).padding(horizontal = s.dp(40)), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text(when (tab) { "contacts" -> "通讯录"; "mine" -> "我的"; else -> "聊天" }, fontSize = s.text(48), lineHeight = s.text(64), color = Ink, fontWeight = FontWeight.Bold)
            if (tab != "mine") Row(verticalAlignment = Alignment.CenterVertically) {
                if (tab == "chat") Text("⋯", Modifier.size(s.dp(64)).clickable { toast(if (state.sample) "本地样例没有待标记的未读消息。" else "聊天功能接入中。") }.wrapContentSize(), fontSize = s.text(44), fontWeight = FontWeight.Bold)
                Image(painterResource(R.drawable.uni_icon_plus), "添加", Modifier.size(s.dp(64)).padding(s.dp(8)).clickable { toast("添加朋友、群聊与创建群聊尚未接入。") })
            }
        }
        Box(Modifier.weight(1f)) {
            when (tab) {
                "chat" -> ConversationList(state, model, s, toast)
                "contacts" -> Column(Modifier.fillMaxSize()) {
                    Search(s, "搜索", "", {}, toast)
                    Text(if (state.sample) "当前本地样例没有通讯录。" else "通讯录功能接入中。", Modifier.align(Alignment.CenterHorizontally).padding(top = s.dp(80)), fontSize = s.text(28), color = Hint)
                }
                else -> Column(Modifier.fillMaxSize().padding(horizontal = s.dp(40))) {
                    Row(Modifier.fillMaxWidth().padding(vertical = s.dp(36)), verticalAlignment = Alignment.CenterVertically) {
                        Image(painterResource(R.drawable.uni_avatar_default), "我的头像", Modifier.size(s.dp(112)).clip(CircleShape))
                        Column(Modifier.padding(start = s.dp(28))) {
                            Text(if (state.sample) "本地样例" else state.profile?.nickname?.ifBlank { "当前账号" } ?: "当前账号", fontSize = s.text(36), fontWeight = FontWeight.Bold)
                            if (!state.sample) {
                                state.profile?.publicId?.takeIf { it.isNotBlank() }?.let { Text("账号：$it", Modifier.padding(top = s.dp(12)), fontSize = s.text(26), color = Hint) }
                                state.profile?.phoneMasked?.takeIf { it.isNotBlank() }?.let { Text(it, Modifier.padding(top = s.dp(8)), fontSize = s.text(26), color = Hint) }
                            }
                        }
                    }
                    Text(if (state.sample) "本轮仅还原登录、导航、会话和文本聊天。" else "聊天、通讯录功能接入中。", Modifier.padding(vertical = s.dp(20)), fontSize = s.text(26), color = Hint)
                    Text(if (state.sample) "退出本地样例并清除内容" else "退出登录", Modifier.fillMaxWidth().clickable { model.logout() }.padding(vertical = s.dp(30)), fontSize = s.text(28), color = Primary)
                }
            }
        }
        Row(Modifier.fillMaxWidth().background(Color.White).height(s.dp(144)).padding(vertical = s.dp(16)), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
            val tabs = listOf(Triple("contacts", "通讯录", if (tab == "contacts") R.drawable.uni_tab_contacts_active else R.drawable.uni_tab_contacts), Triple("chat", "聊天", if (tab == "chat") R.drawable.uni_tab_chat_active else R.drawable.uni_tab_chat), Triple("mine", "我的", if (tab == "mine") R.drawable.uni_tab_mine_active else R.drawable.uni_tab_mine))
            tabs.forEach { (id, name, image) -> Column(Modifier.widthIn(min = s.dp(120)).fillMaxHeight().clickable { changeTab(id) }, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Image(painterResource(image), null, Modifier.size(s.dp(48)))
                Text(name, Modifier.padding(top = s.dp(4)), color = if (tab == id) Primary else Ink, fontSize = s.text(24), lineHeight = s.text(32))
            } }
        }
    }
}

@Composable
private fun ConversationList(state: BootstrapState, model: BootstrapViewModel, s: UniScale, toast: (String) -> Unit) {
    var query by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize()) {
        Search(s, "搜索聊天 / 关键词", query, { query = it }, toast)
        Row(Modifier.fillMaxWidth().padding(start = s.dp(40), end = s.dp(40), bottom = s.dp(8)), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
            Text("全部", Modifier.clickable { toast(if (state.sample) "本地样例仅展示一条会话。" else "聊天功能接入中。") }, color = Hint, fontSize = s.text(24), lineHeight = s.text(40))
            Text("▾", Modifier.padding(start = s.dp(4)), color = Hint, fontSize = s.text(20))
        }
        if (state.sample && (query.isBlank() || "交互测试 本地样例".contains(query))) Row(Modifier.fillMaxWidth().clickable { model.openChat() }.padding(horizontal = s.dp(40), vertical = s.dp(24)), verticalAlignment = Alignment.CenterVertically) {
            Image(painterResource(R.drawable.uni_avatar_1), "交互测试头像", Modifier.size(s.dp(96)).clip(CircleShape), contentScale = ContentScale.Crop)
            Column(Modifier.weight(1f).padding(start = s.dp(24))) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text("交互测试", Modifier.weight(1f), fontSize = s.text(32), fontWeight = FontWeight.Medium, color = Color(0xFF111111))
                    Text("现在", fontSize = s.text(24), color = Color(0xFF999999))
                }
                Text("本地样例，仅在本机内存中", Modifier.padding(top = s.dp(12)), fontSize = s.text(26), color = Color(0xFF999999), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        } else Text(if (state.sample) "暂无对话…" else "聊天功能接入中", Modifier.fillMaxWidth().padding(vertical = s.dp(80)).wrapContentWidth(), fontSize = s.text(32))
    }
}

@Composable
private fun Search(s: UniScale, placeholder: String, value: String, change: (String) -> Unit, toast: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = s.dp(40), vertical = s.dp(16)).height(s.dp(72)).clip(RoundedCornerShape(s.dp(8))).background(Color(0xFFF3F4F7)).padding(start = s.dp(32), end = s.dp(24)), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(s.dp(16))) {
        Canvas(Modifier.size(16.dp)) { drawCircle(Color(0xFF8A8F9C), radius = size.width * .32f, center = Offset(size.width * .4f, size.height * .4f), style = Stroke(1.5.dp.toPx())); drawLine(Color(0xFF8A8F9C), Offset(size.width * .64f, size.height * .64f), Offset(size.width * .94f, size.height * .94f), strokeWidth = 1.5.dp.toPx()) }
        BasicTextField(value, change, Modifier.weight(1f), singleLine = true, textStyle = TextStyle(fontSize = s.text(28), color = Ink), cursorBrush = SolidColor(Primary), decorationBox = { inner -> Box { if (value.isEmpty()) Text(placeholder, fontSize = s.text(28), color = Color(0xFF626E8D)); inner() } })
        if (value.isNotEmpty()) Text("×", Modifier.clickable { change("") }, fontSize = s.text(28), color = Hint)
    }
}

@Composable
private fun SampleStrip(s: UniScale) {
    Text("本地样例 · 不联网，不送达", Modifier.fillMaxWidth().background(Color(0xFFF3F4F7)).padding(horizontal = s.dp(24), vertical = s.dp(6)), fontSize = s.text(22), color = Hint)
}

@Composable
private fun UniChat(state: BootstrapState, model: BootstrapViewModel, s: UniScale, toast: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    val lastId = state.messages.lastOrNull()?.id
    LaunchedEffect(lastId) { if (state.messages.isNotEmpty()) listState.animateScrollToItem(state.messages.lastIndex) }
    Column(Modifier.fillMaxSize().background(Color.White).statusBarsPadding().navigationBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().background(Color.White).height(s.dp(110)).padding(horizontal = s.dp(26), vertical = s.dp(8)), verticalAlignment = Alignment.CenterVertically) {
            Text("‹", Modifier.size(s.dp(52)).clickable { model.closeChat() }.wrapContentSize(), fontSize = s.text(52), color = Color(0xFF1A1A1A))
            Text("交互测试", Modifier.weight(1f), fontSize = s.text(34), fontWeight = FontWeight.Bold, color = Color(0xFF111111))
            Text("⋯", Modifier.size(s.dp(52)).clickable { toast("聊天资料与更多操作尚未接入。") }.wrapContentSize(), fontSize = s.text(42), color = Color(0xFF444444))
        }
        SampleStrip(s)
        LazyColumn(state = listState, modifier = Modifier.weight(1f).fillMaxWidth().background(ScreenGray), contentPadding = PaddingValues(vertical = s.dp(8))) {
            items(state.messages, key = { it.id }, contentType = { "text" }) { msg ->
                Row(Modifier.fillMaxWidth().padding(horizontal = s.dp(24), vertical = s.dp(16)), horizontalArrangement = if (msg.mine) Arrangement.End else Arrangement.Start, verticalAlignment = Alignment.Top) {
                    if (!msg.mine) Image(painterResource(R.drawable.uni_avatar_1), "对方头像", Modifier.size(s.dp(72)).clip(CircleShape), contentScale = ContentScale.Crop)
                    Column(Modifier.widthIn(max = (LocalConfiguration.current.screenWidthDp * .7f).dp).padding(horizontal = s.dp(16)), horizontalAlignment = if (msg.mine) Alignment.End else Alignment.Start) {
                        val shape = if (msg.mine) RoundedCornerShape(s.dp(16), s.dp(4), s.dp(16), s.dp(16)) else RoundedCornerShape(s.dp(4), s.dp(16), s.dp(16), s.dp(16))
                        Text(msg.text, Modifier.clip(shape).background(if (msg.mine) Color(0xFF2B5CFF) else Color.White).padding(horizontal = s.dp(22), vertical = s.dp(18)), fontSize = s.text(30), lineHeight = s.text(45), color = if (msg.mine) Color.White else Color(0xFF222222))
                    }
                    if (msg.mine) Image(painterResource(R.drawable.uni_avatar_default), "我的头像", Modifier.size(s.dp(72)).clip(CircleShape), contentScale = ContentScale.Crop)
                }
            }
        }
        Row(Modifier.fillMaxWidth().background(Color(0xFFF7F7F7)).padding(horizontal = s.dp(20), vertical = s.dp(18)), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(s.dp(12))) {
            Box(Modifier.size(s.dp(64)).clickable { toast("语音录制尚未接入，本地样例仅支持文本。") }, contentAlignment = Alignment.Center) { Image(painterResource(R.drawable.uni_icon_mic), "语音", Modifier.size(s.dp(44))) }
            Row(Modifier.weight(1f).heightIn(min = s.dp(72)).clip(RoundedCornerShape(s.dp(12))).background(Color.White).padding(start = s.dp(18)), verticalAlignment = Alignment.CenterVertically) {
                BasicTextField(text, { text = it }, Modifier.weight(1f), singleLine = true, textStyle = TextStyle(fontSize = s.text(28), color = Ink), cursorBrush = SolidColor(Primary), decorationBox = { inner -> Box { if (text.isEmpty()) Text("输入消息", fontSize = s.text(28), color = Color(0xFFB0B0B0)); inner() } })
                Text("☺", Modifier.size(s.dp(60)).clickable { toast("表情面板尚未接入。") }.wrapContentSize(), fontSize = s.text(36), color = Color(0xFF666666))
            }
            Text("+", Modifier.size(s.dp(64)).clickable { toast("照片、文件与收藏尚未接入。") }.wrapContentSize(), fontSize = s.text(40), color = Color(0xFF333333))
            if (text.isNotBlank()) Box(Modifier.height(s.dp(64)).clip(RoundedCornerShape(s.dp(10))).background(Primary).clickable { model.sendSample(text); text = "" }.padding(horizontal = s.dp(24)), contentAlignment = Alignment.Center) { Text("传送", fontSize = s.text(28), color = Color.White) }
        }
    }
}
