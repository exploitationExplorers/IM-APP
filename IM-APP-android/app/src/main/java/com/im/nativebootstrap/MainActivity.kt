package com.im.nativebootstrap

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.material3.MaterialTheme
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
        window.navigationBarColor = Color.WHITE
        WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightNavigationBars = true
        setContent { MaterialTheme { UniParityApp(model); NativeStartupUpdate(); NativeNoticeHost() } }
    }
}
