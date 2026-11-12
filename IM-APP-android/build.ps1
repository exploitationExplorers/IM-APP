param([string[]]$Tasks = @(':app:testDebugUnitTest', ':app:assembleDebug'), [switch]$Offline)
$ErrorActionPreference = 'Stop'
$projectDir = $PSScriptRoot
$cacheDir = Join-Path (Split-Path $projectDir -Parent) '.native-cache'
$env:GRADLE_USER_HOME = Join-Path $cacheDir 'gradle'
$env:TEMP = Join-Path $cacheDir 'temp'
$env:TMP = $env:TEMP
$env:ANDROID_USER_HOME = Join-Path $cacheDir 'android'
Remove-Item Env:ANDROID_SDK_HOME -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $env:GRADLE_USER_HOME, $env:TEMP, $env:ANDROID_USER_HOME | Out-Null
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = 'D:\JDK17' }
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = 'D:\Android\SDK' }
$localGradle = Join-Path $cacheDir 'tools\gradle-8.4\bin\gradle.bat'
$gradleExe = if (Test-Path -LiteralPath $localGradle) { $localGradle } else { Join-Path $projectDir 'gradlew.bat' }
$buildArgs = @('-p', $projectDir, '--no-daemon', "-Djava.io.tmpdir=$($env:TEMP)") + $Tasks
if ($Offline) { $buildArgs += '--offline' }
& $gradleExe @buildArgs
exit $LASTEXITCODE
