package models

type AppReleasePackageType string

const (
	AppReleaseWgt AppReleasePackageType = "wgt"
	AppReleaseAPK AppReleasePackageType = "apk"
	AppReleaseIPA AppReleasePackageType = "ipa"
)

type AppReleasePlatform string

const (
	AppPlatformAndroid AppReleasePlatform = "android"
	AppPlatformIOS     AppReleasePlatform = "ios"
)

type AppReleaseChannel string

const (
	AppChannelTest AppReleaseChannel = "test"
	AppChannelProd AppReleaseChannel = "prod"
)

type AppUpdateType string

const (
	AppUpdateNone   AppUpdateType = "none"
	AppUpdateWgt    AppUpdateType = "wgt"
	AppUpdateNative AppUpdateType = "native"
)

type AppRelease struct {
	ID               string `json:"id"`
	Platform         string `json:"platform"`
	Channel          string `json:"channel"`
	VersionName      string `json:"versionName"`
	VersionCode      int    `json:"versionCode"`
	PackageType      string `json:"packageType"`
	MinNativeVersion int    `json:"minNativeVersion"`
	DownloadURL      string `json:"downloadUrl"`
	ObjectKey        string `json:"objectKey"`
	Changelog        string `json:"changelog"`
	ForceUpdate      bool   `json:"forceUpdate"`
	Published        bool   `json:"published"`
	CreatedAt        string `json:"createdAt"`
}

type AppReleaseCheckResult struct {
	HasUpdate        bool   `json:"hasUpdate"`
	UpdateType       string `json:"updateType"`
	VersionName      string `json:"versionName"`
	VersionCode      int    `json:"versionCode"`
	MinNativeVersion int    `json:"minNativeVersion"`
	DownloadURL      string `json:"downloadUrl"`
	Changelog        string `json:"changelog"`
	ForceUpdate      bool   `json:"forceUpdate"`
}

type CreateAppReleaseUploadRequest struct {
	Platform    string `json:"platform"`
	PackageType string `json:"packageType"`
	FileName    string `json:"fileName"`
}

type AppReleaseUploadResult struct {
	UploadURL string `json:"uploadUrl"`
	ObjectKey string `json:"objectKey"`
	FileURL   string `json:"fileUrl"`
	ExpiresIn int    `json:"expiresIn"`
}

type PublishAppReleaseRequest struct {
	Platform         string `json:"platform"`
	Channel          string `json:"channel"`
	VersionName      string `json:"versionName"`
	VersionCode      int    `json:"versionCode"`
	PackageType      string `json:"packageType"`
	MinNativeVersion *int   `json:"minNativeVersion"`
	ObjectKey        string `json:"objectKey"`
	Changelog        string `json:"changelog"`
	ForceUpdate      bool   `json:"forceUpdate"`
}
