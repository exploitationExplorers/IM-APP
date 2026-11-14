package com.im.nativebootstrap

import android.app.Activity
import android.webkit.WebView
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
import com.im.nativebootstrap.chat.*
import com.im.nativebootstrap.core.StoreStatus
import com.im.nativebootstrap.core.SyncStatus
import com.im.nativebootstrap.business.*
import com.im.nativebootstrap.media.SharedAvatar
import kotlin.math.abs

private val Primary = Color(0xFF0A2FC2)
private val Ink = Color(0xFF212121)
private val Hint = Color(0xFF636E86)
private val ScreenGray = Color(0xFFE6E8EE)

/** uni-app rpx 只按视口宽度缩放；auth-modern.scss 的 px 直接用 dp。 */
internal class UniScale(private val width: Float) {
    fun dp(rpx: Int): Dp = (width * rpx / 750f).dp
    fun text(rpx: Int) = (width * rpx / 750f).sp
}
private fun cssText(size: Int, color: Color = Ink, weight: FontWeight = FontWeight.Normal) =
    TextStyle(fontSize = size.sp, color = color, fontWeight = weight, platformStyle = PlatformTextStyle(includeFontPadding = false))

@Composable
fun UniParityApp(model: BootstrapViewModel = viewModel()) {
    val state by model.state.collectAsStateWithLifecycle()
    val business by model.business.state.collectAsStateWithLifecycle()
    val preferences by model.settings.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scale = UniScale(LocalConfiguration.current.screenWidthDp.toFloat())
    var debugOpen by remember { mutableStateOf(false) }
    var endpoint by remember { mutableStateOf(RuntimeEndpoints.DEFAULT_API_BASE_URL) }
    var tab by remember { mutableStateOf("chat") }
    var legal by remember { mutableStateOf<String?>(null) }
    var authRoute by remember { mutableStateOf<String?>(null) }
    var chatPicker by remember {mutableStateOf<String?>(null)}
    var globalSearch by remember{mutableStateOf(false)}
    LaunchedEffect(state.authenticated) { if(state.authenticated)authRoute=null else {chatPicker=null;globalSearch=false} }
    val login = !state.sample && !state.authenticated
    LaunchedEffect(state.notice,state.busy) {
        if(!state.busy&&!state.sample&&state.notice.isNotBlank())NativeNotices.show(state.notice)
    }
    LaunchedEffect(business.notice) {
        business.notice?.takeIf(String::isNotBlank)?.let { NativeNotices.show(it);model.business.clearNotice() }
    }
    SideEffect {
        (context as? Activity)?.let { WindowInsetsControllerCompat(it.window, it.window.decorView).isAppearanceLightStatusBars = !login }
    }
    BackHandler(enabled = debugOpen || legal != null || authRoute != null || chatPicker != null || globalSearch || business.subpage || state.chatOpen || state.sample || state.busy) {
        when {
            legal != null -> legal = null
            debugOpen -> debugOpen = false
            authRoute != null -> authRoute = null
            chatPicker != null -> chatPicker = null
            globalSearch -> globalSearch=false
            state.chatOpen -> model.closeChat()
            business.subpage -> model.business.back()
            else -> model.logout()
        }
    }
    val toast: (String) -> Unit = NativeNotices::show
    when {
        login && authRoute != null -> NativeAuthPage(authRoute!!,model,endpoint,{authRoute=null},{legal=it})
        login -> UniLogin(state, endpoint, model, onDebug = { debugOpen = true }, onLegal = { legal = it }, onAuth = { authRoute=it }, toast = toast)
        globalSearch -> NativeGlobalChatSearch({globalSearch=false},model::searchAllMessages){hit->globalSearch=false;model.openSearchHit(hit)}
        chatPicker != null && state.chat.active != null -> {
            val mode=chatPicker!!
            NativeChatPicker(mode,state.chat.active!!.title,{chatPicker=null},
                {keyword,tab,page,cursor,done->model.loadChatPicker(mode,keyword,tab,page,cursor,done)},
                {item,done->model.sendChatPicker(mode,item,done)},model::deleteChatFavorite)
        }
        state.chatOpen && !state.sample -> key(state.chat.active?.target?.conversationId) { NativeChatRoom(state.chat,NativeChatCallbacks(
            onBack=model::closeChat,onLoadHistory=model::loadHistory,onSendText=model::sendQuotedText,onSendMedia=model::sendMedia,
            onReconcile=model::reconcileMessage,onRetryFailed=model::retryFailedMessage,onRetryUpload=model::retryImageUpload,onDiscardUpload=model::discardImageUpload,onAction=model::messageAction,onForward=model::forwardMessage,
            onOpenPeer={model.closeChat();model.openPeerProfile(it)},onOpenDetails=model::openChatDetails,
            onOpenFavorites={chatPicker="favorite"},onOpenCards={chatPicker="card"},onLoadMentions=model::loadMentions,onSelectMention=model::selectMention,
            onLoadForward=model::loadForwardTargets,onSubmitForward=model::submitForward,onForwardProgress=model::forwardProgress,onForwardTaskAction=model::forwardTaskAction,onConsumeForwardNotice=model::consumeForwardNotice,
            onReportUser=model::reportChatUser,onLoadMessageMenu=model::loadMessageMenu,onAddSticker=model::addChatSticker,
            onLoadStickers=model::loadChatStickers,onSendSticker=model::sendChatSticker,onDeleteSticker=model::deleteChatSticker,onManageStickers=model::manageChatStickers,
            onRefreshPermission=model::refreshChatPermission,onRecall=model::recallChatMessage,
            onAcceptGroupInvite=model::acceptChatGroupInvite,onOpenBusinessGroup=model::openBusinessGroupFromChat,onOpenJoinRequests=model::openJoinRequestsFromChat,
            onOpenAnnouncements=model::openAnnouncementsFromChat,onDismissAnnouncement=model::dismissChatAnnouncement,onDismissPin=model::dismissChatPin,onLoadGroupMembers=model::loadVisibleChatMembers
        ),state.profile?.avatar.orEmpty(),preferences.enterToSend) }
        state.chatOpen -> key("offline-sample") { UniChat(state, model, scale, toast) }
        state.authenticated && business.subpage -> NativeBusinessPage(model.business,model){legal=it}
        else -> UniHome(state, model, scale, tab, { tab = it }, toast,onSearch={globalSearch=true})
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
private fun UniLogin(state: BootstrapState, endpoint: String, model: BootstrapViewModel, onDebug: () -> Unit, onLegal: (String) -> Unit, onAuth:(String)->Unit, toast: (String) -> Unit) {
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
                    Text("忘记密码", Modifier.clickable { onAuth("forgot") }, style = cssText(13, Color.White), lineHeight = 24.sp)
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
                Spacer(Modifier.height(28.dp))
                Text("立即注册", Modifier.clickable { onAuth("register") }, style = cssText(14, Color.White), lineHeight = 24.sp)
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
internal fun UniHome(state: BootstrapState, model: BootstrapViewModel, s: UniScale, tab: String, changeTab: (String) -> Unit, toast: (String) -> Unit,onSearch:()->Unit={},businessController:BusinessController=model.business) {
    var addMenu by remember { mutableStateOf(false) }
    var moreMenu by remember{mutableStateOf(false)}
    Column(Modifier.fillMaxSize().background(Color.White).statusBarsPadding().navigationBarsPadding()) {
        if (state.sample) SampleStrip(s) else state.profileWarning?.let { Text(it, Modifier.fillMaxWidth().background(Color(0xFFF3F4F7)).padding(horizontal = s.dp(24), vertical = s.dp(12)), fontSize = s.text(24), color = Hint) }
        if(!state.sample && tab=="chat") ChatStatus(state,model,s)
        if(tab!="mine" || state.sample) Row(Modifier.fillMaxWidth().height(s.dp(96)).padding(horizontal = s.dp(40)), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text(when (tab) { "contacts" -> "通讯录"; "mine" -> "我的"; else -> "聊天" }, fontSize = s.text(48), lineHeight = s.text(64), color = Ink, fontWeight = FontWeight.Bold)
            if (tab != "mine") Row(verticalAlignment = Alignment.CenterVertically) {
                if (tab == "chat")Box {
                    Text("⋯",Modifier.size(s.dp(64)).clickable{moreMenu=true}.wrapContentSize(),fontSize=s.text(44),fontWeight=FontWeight.Bold)
                    androidx.compose.material3.DropdownMenu(moreMenu,{moreMenu=false}){androidx.compose.material3.DropdownMenuItem(text={Text("全部已读")},onClick={moreMenu=false;if(state.sample)toast("本地样例没有未读消息") else model.markLoadedConversationsRead(toast)})}
                }
                Box {
                    Image(painterResource(R.drawable.uni_icon_plus), "添加", Modifier.size(s.dp(64)).padding(s.dp(8)).clickable { if(!state.sample)addMenu=true })
                    androidx.compose.material3.DropdownMenu(addMenu,{addMenu=false}) {
                        listOf("添加朋友" to "add-friend","添加群聊" to "add-group","创建群聊" to "create-group","扫一扫" to "scan").forEach{(label,page)->androidx.compose.material3.DropdownMenuItem(text={Text(label)},onClick={addMenu=false;model.business.open(page)})}
                    }
                }
            }
        }
        Box(Modifier.weight(1f)) {
            when (tab) {
                "chat" -> ConversationList(state, model, s, toast,onSearch)
                "contacts" -> if(!state.sample)ContactsHome(businessController,state.chat.conversations.filter{it.target.sessionType==1}.map{businessUserId(it.target.userId)}) else Column(Modifier.fillMaxSize()) {
                    Search(s, "搜索", "", {}, toast)
                    Text(if (state.sample) "当前本地样例没有通讯录。" else "通讯录功能接入中。", Modifier.align(Alignment.CenterHorizontally).padding(top = s.dp(80)), fontSize = s.text(28), color = Hint)
                }
                else -> if(!state.sample)MineHome(businessController,state.profile,model::logout) else Column(Modifier.fillMaxSize().padding(horizontal = s.dp(40))) {
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
                    Text(if (state.sample) "本轮仅还原登录、导航、会话和文本聊天。" else "当前已登录，聊天状态可在聊天页查看。", Modifier.padding(vertical = s.dp(20)), fontSize = s.text(26), color = Hint)
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

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ConversationList(state: BootstrapState, model: BootstrapViewModel, s: UniScale, toast: (String) -> Unit,onSearch:()->Unit) {
    var query by remember { mutableStateOf("") }
    var filterUnread by remember{mutableStateOf(false)}
    var filters by remember{mutableStateOf(false)}
    var swipe by remember{mutableStateOf<String?>(null)}
    var hits by remember{mutableStateOf(emptyList<ChatGlobalHit>())};var searchPage by remember{mutableIntStateOf(0)};var searchEnd by remember{mutableStateOf(false)};var searching by remember{mutableStateOf(false)};var searchError by remember{mutableStateOf("")};var searchVersion by remember{mutableIntStateOf(0)}
    fun searchMore(reset:Boolean=false){
        if(query.isBlank()||searching&&!reset)return
        if(reset){searchVersion++;hits=emptyList();searchPage=0;searchEnd=false}
        val version=searchVersion;searching=true;searchError=""
        model.searchAllMessages(query,searchPage+1,60){result->if(version==searchVersion){searching=false;result.fold({page->hits=(hits+page.hits).distinctBy{it.conversation.target.conversationId+":"+it.message.id};searchPage=page.page;searchEnd=page.end},{searchError=it.message?:"搜索未完成"})}}
    }
    LaunchedEffect(query){searchVersion++;searching=false;hits=emptyList();searchPage=0;searchEnd=false;if(query.isNotBlank()&&!state.sample){kotlinx.coroutines.delay(300);searchMore(true)}}
    var selected by remember{mutableStateOf<ChatConversation?>(null)}
    val result:(Result<Unit>)->Unit={it.fold({},{error->toast(error.message?:"操作未完成")})}
    selected?.let{item->AlertDialog(onDismissRequest={selected=null},title={Text(item.title)},text={Column {
        TextButton(onClick={selected=null;model.updateConversation(item,pinned=!item.pinned,done=result)}){Text(if(item.pinned)"取消置顶" else "置顶")}
        TextButton(onClick={selected=null;model.updateConversation(item,muted=!item.muted,done=result)}){Text(if(item.muted)"取消免打扰" else "消息免打扰")}
        TextButton(onClick={selected=null;model.markConversationRead(item,result)}){Text("标为已读")}
        TextButton(onClick={selected=null;model.hideConversation(item,result)}){Text("移出会话列表")}
    }},confirmButton={TextButton(onClick={selected=null}){Text("取消")}})}
    Column(Modifier.fillMaxSize()) {
        Search(s, "搜索聊天 / 关键词", query, { query = it }, toast)
        Row(Modifier.fillMaxWidth().padding(start = s.dp(40), end = s.dp(40), bottom = s.dp(8)), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
            if(!state.sample&&state.chat.conversations.any{it.unread>0})Text("全部已读",Modifier.weight(1f).clickable{model.markLoadedConversationsRead(toast)},color=Primary,fontSize=s.text(24))
            Box {
                Text(if(filterUnread)"未读" else "全部", Modifier.clickable { filters=true }, color = Hint, fontSize = s.text(24), lineHeight = s.text(40))
                androidx.compose.material3.DropdownMenu(filters,{filters=false}){listOf(false to "全部",true to "未读").forEach{(unread,label)->androidx.compose.material3.DropdownMenuItem(text={Text(label)},onClick={filterUnread=unread;filters=false})}}
            }
            Text("▾", Modifier.padding(start = s.dp(4)), color = Hint, fontSize = s.text(20))
        }
        if(!state.sample) {
            NativePullRefresh(state.chat.conversationsLoading,{model.loadConversations(true)},Modifier.weight(1f)){LazyColumn(Modifier.fillMaxSize()) {
                items(state.chat.conversations.filter { (!filterUnread||it.unread>0)&&(query.isBlank()||it.title.contains(query,true)||it.preview.contains(query,true)) },key={ it.target.conversationId }) { item ->
                    NativeConversationSwipe(swipe==item.target.conversationId,{swipe=item.target.conversationId},{swipe=null},item.pinned,s.dp(140),{model.updateConversation(item,pinned=!item.pinned,done=result)},{model.hideConversation(item,result)}) {
                    Row(Modifier.fillMaxWidth().background(if(item.pinned)Color(0xFFF3F4F7) else Color.White).combinedClickable(onClick={if(swipe!=null)swipe=null else model.openRealChat(item)},onLongClick={selected=item}).padding(horizontal=s.dp(40),vertical=s.dp(24)),verticalAlignment=Alignment.CenterVertically) {
                        SharedAvatar(item.avatar,Modifier.size(s.dp(96)).clip(CircleShape),item.target.sessionType==3)
                        Column(Modifier.weight(1f).padding(start=s.dp(24))) {
                            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {
                                Text(item.title,Modifier.weight(1f),fontSize=s.text(32),fontWeight=FontWeight.Medium,maxLines=1,overflow=TextOverflow.Ellipsis)
                                if(item.time>0)Text(java.text.SimpleDateFormat("HH:mm",java.util.Locale.getDefault()).format(java.util.Date(if(item.time<10_000_000_000L)item.time*1000 else item.time)),fontSize=s.text(22),color=Color(0xFF999999))
                            }
                            Row(Modifier.padding(top=s.dp(12)),verticalAlignment=Alignment.CenterVertically){Text(item.preview,Modifier.weight(1f),fontSize=s.text(26),color=Color(0xFF999999),maxLines=1,overflow=TextOverflow.Ellipsis);if(item.muted)Text("免打扰",fontSize=s.text(20),color=Hint);if(item.unread>0)Text(if(item.unread>99)"99+" else item.unread.toString(),Modifier.padding(start=s.dp(8)).clip(CircleShape).background(Color(0xFFEF4444)).padding(horizontal=s.dp(10),vertical=s.dp(2)),fontSize=s.text(22),color=Color.White)}
                        }
                    }
                    }
                }
                if(query.isNotBlank()) {
                    items(hits.groupBy{it.conversation.target.conversationId}.values.toList(),key={"search:"+it.first().conversation.target.conversationId}){matches->
                        val hit=matches.first()
                        Row(Modifier.fillMaxWidth().clickable{model.openSearchHit(hit)}.padding(horizontal=s.dp(40),vertical=s.dp(20)),verticalAlignment=Alignment.CenterVertically){SharedAvatar(hit.conversation.avatar,Modifier.size(s.dp(96)),hit.conversation.target.sessionType==3);Column(Modifier.weight(1f).padding(start=s.dp(24))){Text(hit.conversation.title,fontSize=s.text(32));Text("${matches.size} 条相关聊天记录",fontSize=s.text(24),color=Hint);Text(hit.message.text,maxLines=1,overflow=TextOverflow.Ellipsis,fontSize=s.text(26),color=Hint)}}
                    }
                    item{Text(if(searching)"搜索中…" else if(searchError.isNotBlank())searchError+" · 重试" else if(searchEnd)"没有更多了" else "点击查找更早的聊天记录",Modifier.fillMaxWidth().clickable(enabled=!searching){searchMore()}.padding(s.dp(28)).wrapContentWidth(),fontSize=s.text(24),color=Hint)}
                }
                item {
                    Text(when { state.chat.conversationsLoading->"正在读取…";state.chat.conversations.isEmpty()->"暂无对话，点击重试读取";state.chat.conversationsEnd->"已显示全部会话";else->"加载更多会话" },Modifier.fillMaxWidth().clickable(enabled=state.chat.loggedIn&&!state.chat.conversationsLoading) { model.loadConversations(state.chat.conversations.isEmpty()) }.padding(s.dp(32)).wrapContentWidth(),fontSize=s.text(26),color=Hint)
                }
            }
            }
            return@Column
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
    val displayMessages=if(state.sample) state.messages.map { ChatMessage(it.id,it.text,it.mine,0) } else state.chat.messages
    var text by remember { mutableStateOf("") }
    var submitting by remember { mutableStateOf(false) }
    var initialScrollDone by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()
    val lastId = displayMessages.lastOrNull()?.id
    LaunchedEffect(lastId,state.chat.historyLoading) {
        if(displayMessages.isNotEmpty()) {
            val end=displayMessages.lastIndex+if(state.sample)0 else 1
            if(!initialScrollDone && (state.sample||!state.chat.historyLoading)) { listState.scrollToItem(end);initialScrollDone=true }
            else if(initialScrollDone && (listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: Int.MAX_VALUE)>=end-2) listState.animateScrollToItem(end)
        }
    }
    Column(Modifier.fillMaxSize().background(Color.White).statusBarsPadding().navigationBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().background(Color.White).height(s.dp(110)).padding(horizontal = s.dp(26), vertical = s.dp(8)), verticalAlignment = Alignment.CenterVertically) {
            Text("‹", Modifier.size(s.dp(52)).clickable { model.closeChat() }.wrapContentSize(), fontSize = s.text(52), color = Color(0xFF1A1A1A))
            Text(if(state.sample) "交互测试" else state.chat.active?.title.orEmpty(), Modifier.weight(1f), fontSize = s.text(34), fontWeight = FontWeight.Bold, color = Color(0xFF111111))
            Text("⋯", Modifier.size(s.dp(52)).clickable { toast("聊天资料与更多操作尚未接入。") }.wrapContentSize(), fontSize = s.text(42), color = Color(0xFF444444))
        }
        if(state.sample) SampleStrip(s) else {
            ChatStatus(state,model,s)
            if(state.chat.active?.target?.sessionType==3) Text("群消息保留规则尚未完成验证",Modifier.fillMaxWidth().padding(s.dp(12)),fontSize=s.text(22),color=Hint)
        }
        LazyColumn(state = listState, modifier = Modifier.weight(1f).fillMaxWidth().background(ScreenGray), contentPadding = PaddingValues(vertical = s.dp(8))) {
            if(!state.sample) item {
                Text(when { state.chat.historyLoading->"正在读取…";state.chat.historyEnd->"已到最早消息";else->"加载更早消息 / 重试" },Modifier.fillMaxWidth().clickable(enabled=state.chat.ready&&!state.chat.historyLoading&&!state.chat.historyEnd) { model.loadHistory() }.padding(s.dp(24)).wrapContentWidth(),fontSize=s.text(24),color=Hint)
            }
            items(displayMessages, key = { it.id }, contentType = { "text" }) { msg ->
                Row(Modifier.fillMaxWidth().padding(horizontal = s.dp(24), vertical = s.dp(16)), horizontalArrangement = if (msg.mine) Arrangement.End else Arrangement.Start, verticalAlignment = Alignment.Top) {
                    if (!msg.mine) Image(painterResource(R.drawable.uni_avatar_1), "对方头像", Modifier.size(s.dp(72)).clip(CircleShape), contentScale = ContentScale.Crop)
                    Column(Modifier.widthIn(max = (LocalConfiguration.current.screenWidthDp * .7f).dp).padding(horizontal = s.dp(16)), horizontalAlignment = if (msg.mine) Alignment.End else Alignment.Start) {
                        val shape = if (msg.mine) RoundedCornerShape(s.dp(16), s.dp(4), s.dp(16), s.dp(16)) else RoundedCornerShape(s.dp(4), s.dp(16), s.dp(16), s.dp(16))
                        if(!state.sample && !msg.mine && state.chat.active?.target?.sessionType==3 && msg.sender.isNotBlank()) Text(msg.sender,Modifier.padding(bottom=s.dp(4)),fontSize=s.text(22),color=Hint)
                        Text(msg.text, Modifier.clip(shape).background(if (msg.mine) Color(0xFF2B5CFF) else Color.White).padding(horizontal = s.dp(22), vertical = s.dp(18)), fontSize = s.text(30), lineHeight = s.text(45), color = if (msg.mine) Color.White else Color(0xFF222222))
                        if(!state.sample && msg.mine) {
                            val pending=state.chat.outbox.firstOrNull { it.id==msg.id }
                            val label=when(pending?.state) { OutboxState.PENDING->"待提交";OutboxState.SENDING->"发送中";OutboxState.UNCERTAIN->"结果待核对 · 点击核对";OutboxState.FAILED->"发送失败 · 点击核对";OutboxState.ACCEPTED->"已提交";null->if(msg.status==2||msg.seq>0) "已提交" else "结果待核对" }
                            Text(label,Modifier.padding(top=s.dp(6)).clickable(enabled=pending!=null&&pending.state !in listOf(OutboxState.SENDING,OutboxState.ACCEPTED)) { model.reconcileMessage(msg.id) },fontSize=s.text(20),color=Hint)
                        }
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
            if (text.isNotBlank()) Box(Modifier.height(s.dp(64)).clip(RoundedCornerShape(s.dp(10))).background(Primary).clickable(enabled=!submitting&&(state.sample||state.chat.ready)) {
                val submittedText=text
                submitting=true
                model.sendText(submittedText) { saved -> submitting=false;if(saved&&text==submittedText) text="" }
            }.padding(horizontal = s.dp(24)), contentAlignment = Alignment.Center) { Text("传送", fontSize = s.text(28), color = Color.White) }
        }
    }
}

@Composable
private fun ChatStatus(state:BootstrapState,model:BootstrapViewModel,s:UniScale) {
    val chat=state.chat
    val connection=when(chat.connection) { ConnectionState.IDLE->"聊天待连接";ConnectionState.CONNECTING->"连接中";ConnectionState.CONNECTED->"已连接";ConnectionState.DISCONNECTED->"连接中断，正在重连";ConnectionState.AUTH_REQUIRED->"聊天登录已失效" }
    val store=when(chat.store) { StoreStatus.CLOSED->"本地记录未打开";StoreStatus.OPENING->"本地记录准备中";StoreStatus.READABLE->"本地记录可读";StoreStatus.FAILED->"本地记录暂不可用" }
    val sync=when(chat.sync) { SyncStatus.IDLE->"等待同步";SyncStatus.RUNNING->"同步中";SyncStatus.COMPLETED->"同步完成";SyncStatus.FAILED->"同步未完成";SyncStatus.TIMED_OUT->"同步超时";SyncStatus.CANCELLED->"同步已取消" }
    Column(Modifier.fillMaxWidth().background(Color(0xFFF3F4F7)).padding(horizontal=s.dp(24),vertical=s.dp(8))) {
        Text("$connection · $store · $sync",fontSize=s.text(21),color=Hint)
        chat.error?.let { Text(it,Modifier.clickable(enabled=chat.loggedIn) { if(chat.active==null) model.loadConversations(true) else model.loadHistory() }.padding(top=s.dp(6)),fontSize=s.text(24),color=Primary) }
    }
}
