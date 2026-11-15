package com.im.nativebootstrap.business

import androidx.compose.foundation.layout.*
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.pulltorefresh.PullToRefreshContainer
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.input.nestedscroll.nestedScroll

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun NativePullRefresh(refreshing:Boolean,onRefresh:()->Unit,modifier:Modifier=Modifier,content:@Composable BoxScope.()->Unit) {
    val pull=rememberPullToRefreshState()
    val busy by rememberUpdatedState(refreshing)
    val refresh by rememberUpdatedState(onRefresh)
    // 手势阈值和业务请求各自拥有状态，程序加载不能反向触发一次用户刷新。
    LaunchedEffect(pull.isRefreshing) {
        if(pull.isRefreshing) {
            try {if(!busy)refresh()} finally {pull.endRefresh()}
        }
    }
    Box(modifier.nestedScroll(pull.nestedScrollConnection)) {
        content()
        if(refreshing)Box(Modifier.align(Alignment.TopCenter).padding(top=12.dp)) {
            CircularProgressIndicator(Modifier.size(24.dp),strokeWidth=2.dp)
        }
        else if(pull.isRefreshing||pull.progress>0f)PullToRefreshContainer(pull,Modifier.align(Alignment.TopCenter))
    }
}
