package com.im.nativebootstrap.business

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.im.nativebootstrap.NativeFavoriteContent

@Composable fun StickerManager(state:BusinessState,controller:BusinessController,uploading:Boolean,upload:()->Unit) {
    var managing by remember{mutableStateOf(false)}
    var selected by remember{mutableStateOf(emptySet<String>())}
    var confirm by remember{mutableStateOf(false)}
    LaunchedEffect(state.items){selected=selected.intersect(state.items.map{it.identifier()}.toSet())}
    Row(Modifier.fillMaxWidth().padding(8.dp),horizontalArrangement=Arrangement.SpaceBetween) {
        TextButton(enabled=!uploading&&!state.loading,onClick=upload){Text("添加表情")}
        TextButton(onClick={managing=!managing;selected=emptySet()}){Text(if(managing)"完成" else "管理")}
    }
    state.items.chunked(3).forEach{row->Row(Modifier.fillMaxWidth().padding(horizontal=12.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
        row.forEach{sticker->Column(Modifier.weight(1f).background(Color.White).padding(10.dp),horizontalAlignment=Alignment.CenterHorizontally) {
            NativeFavoriteContent("image",sticker.text("url"))
            if(managing)Checkbox(sticker.identifier() in selected,{checked->selected=if(checked)selected+sticker.identifier() else selected-sticker.identifier()})
        }}
        repeat(3-row.size){Spacer(Modifier.weight(1f))}
    }}
    if(managing) {
        TextButton(onClick={selected=if(selected.size==state.items.size)emptySet() else state.items.map{it.identifier()}.toSet()}){Text(if(selected.size==state.items.size)"取消全选" else "全选")}
        TextButton(enabled=selected.isNotEmpty()&&!state.loading,onClick={confirm=true}){Text("删除（${selected.size}）",color=Color(0xFFDC2828))}
    }
    if(!state.loading&&state.items.isEmpty())Text("暂无表情",Modifier.fillMaxWidth().padding(28.dp).wrapContentWidth(),color=Color.Gray)
    if(state.hasMore)TextButton(onClick={controller.refresh(true)}){Text("加载更多")}
    if(confirm)AlertDialog(onDismissRequest={confirm=false},title={Text("删除表情")},text={Text("确定删除选中的 ${selected.size} 个表情？")},confirmButton={TextButton(onClick={confirm=false;controller.mutate("POST","/stickers/delete",obj("stickerIds" to selected));selected=emptySet()}){Text("删除")}},dismissButton={TextButton(onClick={confirm=false}){Text("取消")}})
}
