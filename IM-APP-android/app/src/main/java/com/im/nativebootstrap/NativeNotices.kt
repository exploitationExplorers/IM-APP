package com.im.nativebootstrap

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.collectLatest

/** 短操作反馈不进入持久页面状态；同一窗口共享一个居中提示宿主。 */
object NativeNotices {
    internal val events=MutableSharedFlow<String>(extraBufferCapacity=32)
    fun show(message:String) { message.trim().takeIf(String::isNotEmpty)?.let { events.tryEmit(it) } }
}

@Composable
fun NativeNoticeHost() {
    var message by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { NativeNotices.events.collectLatest { value->message=value;delay(3000);message=null } }
    Box(Modifier.fillMaxSize()) {
        message?.let { value->Popup(alignment=Alignment.Center,properties=PopupProperties(focusable=false,dismissOnBackPress=false,dismissOnClickOutside=false)) {
            Text(value,Modifier.widthIn(max=300.dp).background(Color(0xE6222222),RoundedCornerShape(10.dp)).padding(horizontal=22.dp,vertical=15.dp).semantics { contentDescription="短时提示";liveRegion=LiveRegionMode.Polite },color=Color.White,textAlign=TextAlign.Center,fontSize=15.sp,lineHeight=22.sp)
        } }
    }
}
