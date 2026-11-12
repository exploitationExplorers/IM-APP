plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

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
        versionCode = 2
        versionName = "0.1.1-login"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }
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
    implementation("com.google.code.gson:gson:2.10")
    testImplementation("junit:junit:4.13.2")
}
