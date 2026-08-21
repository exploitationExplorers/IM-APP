package service

import (
	"context"
	"errors"
	"fmt"
	"path"
	"strings"
	"time"
	"unicode/utf8"

	"im-app-server/internal/infra"
	"im-app-server/internal/models"
	"im-app-server/internal/repository"

	"github.com/google/uuid"
)

var (
	ErrInvalidAppRelease       = errors.New("invalid app release")
	ErrAppReleaseStorage       = errors.New("app release storage unavailable")
	ErrAppReleaseObjectMissing = errors.New("app release object missing")
	ErrAppReleaseVersionUsed   = errors.New("app release version already used")
)

const (
	maxAppReleaseChangelog    = 2000
	maxAppReleaseUploadBytes  = 200 << 20
	appReleaseUploadExpirySec = 900
)

type AppReleaseService struct {
	Releases *repository.AppReleaseRepo
	MinIO    *infra.MinIO
}

func (s *AppReleaseService) Check(ctx context.Context, platform, channel string, nativeVersion, wgtVersion int) (models.AppReleaseCheckResult, error) {
	none := models.AppReleaseCheckResult{UpdateType: string(models.AppUpdateNone)}
	platform, ok := normalizeAppPlatform(platform)
	if !ok {
		return models.AppReleaseCheckResult{}, ErrInvalidAppRelease
	}
	channel, ok = normalizeAppChannel(channel)
	if !ok {
		return models.AppReleaseCheckResult{}, ErrInvalidAppRelease
	}
	if nativeVersion < 0 || wgtVersion < 0 {
		return models.AppReleaseCheckResult{}, ErrInvalidAppRelease
	}

	latest, found, err := s.Releases.LatestPublished(ctx, platform, channel)
	if err != nil {
		return models.AppReleaseCheckResult{}, err
	}
	if !found {
		return none, nil
	}

	switch latest.PackageType {
	case string(models.AppReleaseAPK), string(models.AppReleaseIPA):
		if latest.VersionCode <= nativeVersion {
			return none, nil
		}
		return s.toCheckResult(ctx, latest, models.AppUpdateNative), nil
	case string(models.AppReleaseWgt):
		if latest.VersionCode <= wgtVersion {
			return none, nil
		}
		if latest.MinNativeVersion <= nativeVersion {
			return s.toCheckResult(ctx, latest, models.AppUpdateWgt), nil
		}
		native, hasNative, err := s.Releases.LatestPublishedNative(ctx, platform, channel)
		if err != nil {
			return models.AppReleaseCheckResult{}, err
		}
		if hasNative && native.VersionCode > nativeVersion {
			return s.toCheckResult(ctx, native, models.AppUpdateNative), nil
		}
		return none, nil
	default:
		return none, nil
	}
}

func (s *AppReleaseService) CreateUpload(ctx context.Context, req models.CreateAppReleaseUploadRequest) (models.AppReleaseUploadResult, error) {
	if s.MinIO == nil || !s.MinIO.Available() {
		return models.AppReleaseUploadResult{}, ErrAppReleaseStorage
	}
	platform, ok := normalizeAppPlatform(req.Platform)
	if !ok || strings.TrimSpace(req.FileName) == "" {
		return models.AppReleaseUploadResult{}, ErrInvalidAppRelease
	}
	packageType, ext, ok := normalizePackageType(req.PackageType, req.FileName)
	if !ok {
		return models.AppReleaseUploadResult{}, ErrInvalidAppRelease
	}
	objectKey := fmt.Sprintf("app-releases/%s/%s%s", platform, uuid.NewString(), ext)
	uploadURL, err := s.MinIO.PresignPut(ctx, objectKey, contentTypeForPackage(packageType), time.Duration(appReleaseUploadExpirySec)*time.Second)
	if err != nil {
		return models.AppReleaseUploadResult{}, err
	}
	return models.AppReleaseUploadResult{
		UploadURL: uploadURL,
		ObjectKey: objectKey,
		FileURL:   s.MinIO.FileURL(objectKey),
		ExpiresIn: appReleaseUploadExpirySec,
	}, nil
}

func (s *AppReleaseService) Publish(ctx context.Context, req models.PublishAppReleaseRequest) (models.AppRelease, error) {
	if s.MinIO == nil || !s.MinIO.Available() {
		return models.AppRelease{}, ErrAppReleaseStorage
	}
	platform, ok := normalizeAppPlatform(req.Platform)
	if !ok {
		return models.AppRelease{}, ErrInvalidAppRelease
	}
	channel, ok := normalizeAppChannel(req.Channel)
	if !ok {
		return models.AppRelease{}, ErrInvalidAppRelease
	}
	packageType, _, ok := normalizePackageType(req.PackageType, req.ObjectKey)
	if !ok {
		return models.AppRelease{}, ErrInvalidAppRelease
	}
	versionName := strings.TrimSpace(req.VersionName)
	if versionName == "" || utf8.RuneCountInString(versionName) > 32 || req.VersionCode <= 0 {
		return models.AppRelease{}, ErrInvalidAppRelease
	}
	changelog := strings.TrimSpace(req.Changelog)
	if utf8.RuneCountInString(changelog) > maxAppReleaseChangelog {
		return models.AppRelease{}, ErrInvalidAppRelease
	}
	objectKey := strings.TrimSpace(req.ObjectKey)
	if !strings.HasPrefix(objectKey, "app-releases/") || strings.Contains(objectKey, "..") {
		return models.AppRelease{}, ErrInvalidAppRelease
	}

	info, ok := s.MinIO.ObjectStat(ctx, objectKey)
	if !ok || info.Size <= 0 || info.Size > maxAppReleaseUploadBytes {
		return models.AppRelease{}, ErrAppReleaseObjectMissing
	}

	minNative := 0
	if req.MinNativeVersion != nil {
		if *req.MinNativeVersion < 0 {
			return models.AppRelease{}, ErrInvalidAppRelease
		}
		minNative = *req.MinNativeVersion
	} else if packageType == string(models.AppReleaseWgt) {
		native, found, err := s.Releases.LatestPublishedNative(ctx, platform, channel)
		if err != nil {
			return models.AppRelease{}, err
		}
		if found {
			minNative = native.VersionCode
		}
	}

	maxCode, err := s.Releases.MaxVersionCode(ctx, platform, channel)
	if err != nil {
		return models.AppRelease{}, err
	}
	if req.VersionCode <= maxCode {
		return models.AppRelease{}, ErrAppReleaseVersionUsed
	}

	created, err := s.Releases.Insert(ctx, models.AppRelease{
		Platform:         platform,
		Channel:          channel,
		VersionName:      versionName,
		VersionCode:      req.VersionCode,
		PackageType:      packageType,
		MinNativeVersion: minNative,
		DownloadURL:      s.MinIO.FileURL(objectKey),
		ObjectKey:        objectKey,
		Changelog:        changelog,
		ForceUpdate:      req.ForceUpdate,
	})
	if err != nil {
		if errors.Is(err, repository.ErrAppReleaseVersionConflict) {
			return models.AppRelease{}, ErrAppReleaseVersionUsed
		}
		return models.AppRelease{}, err
	}
	return created, nil
}

func (s *AppReleaseService) List(ctx context.Context, platform, channel string, limit int) ([]models.AppRelease, error) {
	if platform != "" {
		normalized, ok := normalizeAppPlatform(platform)
		if !ok {
			return nil, ErrInvalidAppRelease
		}
		platform = normalized
	}
	if channel != "" {
		normalized, ok := normalizeAppChannel(channel)
		if !ok {
			return nil, ErrInvalidAppRelease
		}
		channel = normalized
	}
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	return s.Releases.List(ctx, platform, channel, limit)
}

func (s *AppReleaseService) toCheckResult(ctx context.Context, item models.AppRelease, updateType models.AppUpdateType) models.AppReleaseCheckResult {
	downloadURL := item.DownloadURL
	if s.MinIO != nil && s.MinIO.Available() && item.ObjectKey != "" {
		if u := s.MinIO.FileURL(item.ObjectKey); u != "" {
			downloadURL = u
		} else if signed, err := s.MinIO.PresignGet(ctx, item.ObjectKey, time.Hour); err == nil && signed != "" {
			downloadURL = signed
		}
	}
	return models.AppReleaseCheckResult{
		HasUpdate:        true,
		UpdateType:       string(updateType),
		VersionName:      item.VersionName,
		VersionCode:      item.VersionCode,
		MinNativeVersion: item.MinNativeVersion,
		DownloadURL:      downloadURL,
		Changelog:        item.Changelog,
		ForceUpdate:      item.ForceUpdate,
	}
}

func normalizeAppPlatform(raw string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case string(models.AppPlatformAndroid):
		return string(models.AppPlatformAndroid), true
	case string(models.AppPlatformIOS), "iphone", "ipad":
		return string(models.AppPlatformIOS), true
	default:
		return "", false
	}
}

func normalizeAppChannel(raw string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", string(models.AppChannelTest):
		return string(models.AppChannelTest), true
	case string(models.AppChannelProd):
		return string(models.AppChannelProd), true
	default:
		return "", false
	}
}

func normalizePackageType(packageType, fileName string) (string, string, bool) {
	ext := strings.ToLower(path.Ext(strings.TrimSpace(fileName)))
	switch strings.ToLower(strings.TrimSpace(packageType)) {
	case string(models.AppReleaseWgt):
		if ext != "" && ext != ".wgt" && ext != ".zip" {
			return "", "", false
		}
		if ext == "" || ext == ".zip" {
			ext = ".wgt"
		}
		return string(models.AppReleaseWgt), ext, true
	case string(models.AppReleaseAPK):
		if ext != "" && ext != ".apk" {
			return "", "", false
		}
		return string(models.AppReleaseAPK), ".apk", true
	case string(models.AppReleaseIPA):
		if ext != "" && ext != ".ipa" {
			return "", "", false
		}
		return string(models.AppReleaseIPA), ".ipa", true
	default:
		return "", "", false
	}
}

func contentTypeForPackage(packageType string) string {
	switch packageType {
	case string(models.AppReleaseAPK):
		return "application/vnd.android.package-archive"
	case string(models.AppReleaseWgt):
		return "application/zip"
	default:
		return "application/octet-stream"
	}
}
