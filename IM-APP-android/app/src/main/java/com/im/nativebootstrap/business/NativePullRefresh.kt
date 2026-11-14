package com.im.nativebootstrap.business

import androidx.compose.foundation.layout.*
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshContainer
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun NativePullRefresh(refreshing:Boolean,onRefresh:()->Unit,modifier:Modifier=Modifier,content:@Composable BoxScope.()->Unit) {
    val pull=rememberPullToRefreshState()
    LaunchedEffect(pull.isRefreshing){if(pull.isRefreshing&&!refreshing)onRefresh()}
    LaunchedEffect(refreshing){if(refreshing)pull.startRefresh() else pull.endRefresh()}
    Box(modifier.nestedScroll(pull.nestedScrollConnection)) {
        content()
        if(refreshing||pull.isRefreshing||pull.progress>0f)PullToRefreshContainer(pull,Modifier.align(Alignment.TopCenter))
    }
}
