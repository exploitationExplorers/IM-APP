import java.net.URI

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

fun nativeSetting(name: String) = providers.gradleProperty(name).orNull ?: providers.environmentVariable(name).orNull.orEmpty()
fun nativeHTTPS(name: String): String = nativeSetting(name).trim().also { value ->
    if (value.isNotEmpty()) {
        val uri = URI(value)
        require(uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.userInfo == null && uri.query == null && uri.fragment == null) { "$name must be an HTTPS URL without credentials, query or fragment" }
    }
}
fun kotlinString(value: String) = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
val nativeManifestURL = nativeHTTPS("NATIVE_UPDATE_MANIFEST_URL")
val nativeDownloadPageURL = nativeHTTPS("NATIVE_DOWNLOAD_PAGE_URL")
val nativeKeystore = nativeSetting("NATIVE_ANDROID_KEYSTORE")
val nativeStorePassword = nativeSetting("NATIVE_ANDROID_STORE_PASSWORD")
val nativeKeyAlias = nativeSetting("NATIVE_ANDROID_KEY_ALIAS")
val nativeKeyPassword = nativeSetting("NATIVE_ANDROID_KEY_PASSWORD")
val nativeSigningValues = listOf(nativeKeystore, nativeStorePassword, nativeKeyAlias, nativeKeyPassword)
require(nativeSigningValues.all { it.isBlank() } || nativeSigningValues.all { it.isNotBlank() }) { "Provide all four NATIVE_ANDROID signing settings together" }

// 正式应用身份与签名尚未核实，本阶段明确禁止构建 release。
gradle.taskGraph.whenReady {
    if (allTasks.any { it.path.startsWith(":app:") && it.name.contains("Release", ignoreCase = true) }) {
        throw GradleException("Production release is blocked: confirm the existing app identity, signing chain, SDK compatibility and migration first.")
    }
}

android {
    namespace = "com.im.nativebootstrap"
    compileSdk = 34
    defaultConfig {
        applicationId = "com.im.nativebootstrap.staging"
        minSdk = 26
        targetSdk = 34
        versionCode = 8
        versionName = "0.3.4-media"
        buildConfigField("String", "NATIVE_UPDATE_MANIFEST_URL", kotlinString(nativeManifestURL))
        buildConfigField("String", "NATIVE_DOWNLOAD_PAGE_URL", kotlinString(nativeDownloadPageURL))
        testInstrumentationRunner = "com.im.nativebootstrap.SDKSmokeInstrumentation"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    signingConfigs {
        if (nativeKeystore.isNotBlank()) create("nativeStaging") {
            storeFile = file(nativeKeystore)
            storePassword = nativeStorePassword
            keyAlias = nativeKeyAlias
            keyPassword = nativeKeyPassword
        }
    }
    buildTypes {
        getByName("debug") {
            if (nativeKeystore.isNotBlank()) signingConfig = signingConfigs.getByName("nativeStaging")
        }
    }
    buildFeatures { compose = true; buildConfig = true }
    sourceSets.getByName("test").resources.srcDir("../../contracts/native-bootstrap/v1/fixtures")
    testOptions { unitTests.isReturnDefaultValues = false }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.06.00"))
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    // 官方 v3.8.3.5 标签声明的固定 core 配对，Maven POM 无传递依赖。
    implementation("io.openim:android-sdk:3.8.3.5@aar")
    implementation("io.openim:core-sdk:3.8.3-patch10@aar")
    implementation("androidx.lifecycle:lifecycle-process:2.8.3")
    implementation("com.google.code.gson:gson:2.10")
    implementation("com.google.zxing:core:3.5.3")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    implementation("io.coil-kt:coil:2.7.0")
    implementation("io.coil-kt:coil-gif:2.7.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    androidTestImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    androidTestImplementation("com.squareup.okhttp3:okhttp-tls:4.12.0")
    testImplementation("junit:junit:4.13.2")
}
