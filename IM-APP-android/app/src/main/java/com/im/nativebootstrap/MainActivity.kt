package com.im.nativebootstrap

import android.content.res.Configuration
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.im.nativebootstrap.update.NativeStartupUpdate

class MainActivity : ComponentActivity() {
    private val model:BootstrapViewModel by viewModels()
    override fun onStart() { super.onStart();model.foreground(true) }
    override fun onStop() { model.foreground(false);super.onStop() }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        val dark=(resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK)==Configuration.UI_MODE_NIGHT_YES
        AppTheme.dark=dark
        WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightNavigationBars=!dark
        // 系统深浅色切换会重建 Activity，这里重新计算即可全局生效；非 Compose 区域（弹层等）由 MaterialTheme 配色兜底。
        setContent {
            val darkNow=isSystemInDarkTheme()
            AppTheme.dark=darkNow
            MaterialTheme(colorScheme=if(darkNow)darkColorScheme() else lightColorScheme()) {
                UniParityApp(model);NativeStartupUpdate();NativeNoticeHost()
            }
        }
    }
}
