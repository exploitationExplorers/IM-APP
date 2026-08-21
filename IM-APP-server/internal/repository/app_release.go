package repository

import (
	"context"
	"errors"
	"time"

	"im-app-server/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

var ErrAppReleaseVersionConflict = errors.New("app release version conflict")

type AppReleaseRepo struct {
	DB *pgxpool.Pool
}

func scanAppRelease(row interface{ Scan(dest ...any) error }) (models.AppRelease, error) {
	var item models.AppRelease
	var createdAt time.Time
	err := row.Scan(
		&item.ID, &item.Platform, &item.Channel, &item.VersionName, &item.VersionCode,
		&item.PackageType, &item.MinNativeVersion, &item.DownloadURL, &item.ObjectKey,
		&item.Changelog, &item.ForceUpdate, &item.Published, &createdAt,
	)
	if err != nil {
		return models.AppRelease{}, err
	}
	item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	return item, nil
}

const appReleaseColumns = `id::text, platform, channel, version_name, version_code, package_type,
	min_native_version, download_url, object_key, changelog, force_update, published, created_at`

func (r *AppReleaseRepo) LatestPublished(ctx context.Context, platform, channel string) (models.AppRelease, bool, error) {
	row := r.DB.QueryRow(ctx, `
		SELECT `+appReleaseColumns+`
		FROM app_releases
		WHERE platform=$1 AND channel=$2 AND published=TRUE
		ORDER BY version_code DESC
		LIMIT 1`, platform, channel)
	item, err := scanAppRelease(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return models.AppRelease{}, false, nil
	}
	if err != nil {
		return models.AppRelease{}, false, err
	}
	return item, true, nil
}

func (r *AppReleaseRepo) LatestPublishedNative(ctx context.Context, platform, channel string) (models.AppRelease, bool, error) {
	row := r.DB.QueryRow(ctx, `
		SELECT `+appReleaseColumns+`
		FROM app_releases
		WHERE platform=$1 AND channel=$2 AND published=TRUE
		  AND package_type IN ('apk', 'ipa')
		ORDER BY version_code DESC
		LIMIT 1`, platform, channel)
	item, err := scanAppRelease(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return models.AppRelease{}, false, nil
	}
	if err != nil {
		return models.AppRelease{}, false, err
	}
	return item, true, nil
}

func (r *AppReleaseRepo) MaxVersionCode(ctx context.Context, platform, channel string) (int, error) {
	var maxCode int
	err := r.DB.QueryRow(ctx, `
		SELECT COALESCE(MAX(version_code), 0)
		FROM app_releases
		WHERE platform=$1 AND channel=$2`, platform, channel).Scan(&maxCode)
	return maxCode, err
}

func (r *AppReleaseRepo) Insert(ctx context.Context, item models.AppRelease) (models.AppRelease, error) {
	row := r.DB.QueryRow(ctx, `
		INSERT INTO app_releases(
			platform, channel, version_name, version_code, package_type,
			min_native_version, download_url, object_key, changelog, force_update, published
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE)
		RETURNING `+appReleaseColumns,
		item.Platform, item.Channel, item.VersionName, item.VersionCode, item.PackageType,
		item.MinNativeVersion, item.DownloadURL, item.ObjectKey, item.Changelog, item.ForceUpdate,
	)
	created, err := scanAppRelease(row)
	if err != nil {
		if isUniqueViolation(err) {
			return models.AppRelease{}, ErrAppReleaseVersionConflict
		}
		return models.AppRelease{}, err
	}
	return created, nil
}

func (r *AppReleaseRepo) List(ctx context.Context, platform, channel string, limit int) ([]models.AppRelease, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT `+appReleaseColumns+`
		FROM app_releases
		WHERE ($1='' OR platform=$1) AND ($2='' OR channel=$2)
		ORDER BY created_at DESC
		LIMIT $3`, platform, channel, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.AppRelease, 0)
	for rows.Next() {
		item, err := scanAppRelease(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}
