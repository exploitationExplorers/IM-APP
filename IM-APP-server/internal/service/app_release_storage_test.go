package service

import (
	"context"
	"strings"
	"testing"

	"im-app-server/internal/config"
	"im-app-server/internal/infra"
	"im-app-server/internal/models"
)

func releaseOSSStorage(t *testing.T) *infra.Storage {
	t.Helper()
	s, err := infra.NewStorage(config.Config{StorageProvider: "oss", OSS: config.OSSConfig{Region: "cn-hangzhou", Bucket: "test-release",
		AccessKeyID: "fake", AccessKeySecret: "fake", KeyPrefix: "oss-test/business/", PublicBaseURL: "https://cdn.example"}})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestReleaseUploadOSSReturnsRequiredHeadersAndScopedKey(t *testing.T) {
	s := &AppReleaseService{Storage: releaseOSSStorage(t)}
	result, err := s.CreateUpload(context.Background(), models.CreateAppReleaseUploadRequest{Platform: "android", PackageType: "wgt", FileName: "test.wgt"})
	if err != nil {
		t.Fatal(err)
	}
	if result.StorageProvider != "oss" || !strings.HasPrefix(result.ObjectKey, "oss-test/business/app-releases/android/") || len(result.Headers) == 0 {
		t.Fatal("OSS PUT contract missing scope or headers")
	}
}

func TestLegacyReleaseURLIsNotRewrittenToOSS(t *testing.T) {
	s := &AppReleaseService{Storage: releaseOSSStorage(t)}
	old := models.AppRelease{DownloadURL: "https://old.example/minio/im-uploads/app-releases/android/old.wgt", ObjectKey: "app-releases/android/old.wgt"}
	got := s.toCheckResult(context.Background(), old, models.AppUpdateWgt)
	if got.DownloadURL != old.DownloadURL {
		t.Fatal("OSS activation changed an existing download URL")
	}
}

func TestOSSReleaseURLSurvivesSwitchBackToMinio(t *testing.T) {
	storage := releaseOSSStorage(t)
	storage.Current = &infra.MinIO{}
	s := &AppReleaseService{Storage: storage}
	old := models.AppRelease{DownloadURL: "https://cdn.example/oss-test/business/app-releases/android/new.wgt", ObjectKey: "oss-test/business/app-releases/android/new.wgt"}
	if s.toCheckResult(context.Background(), old, models.AppUpdateWgt).DownloadURL != old.DownloadURL {
		t.Fatal("rollback rewrote an OSS download URL")
	}
}
