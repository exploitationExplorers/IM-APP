package repository

import (
	"context"
	"encoding/json"

	"im-app-admin/internal/models"
)

// ===== APP 与公共配置（清单 08） =====

func (r *OpsRepo) ListAppVersions(ctx context.Context) ([]models.AppVersion, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT id::text, platform, version, description, download_url, force_upgrade,
		       COALESCE(status,'draft'), created_at FROM app_versions ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]models.AppVersion, 0)
	for rows.Next() {
		var v models.AppVersion
		if err := rows.Scan(&v.ID, &v.Platform, &v.Version, &v.Description, &v.DownloadURL,
			&v.ForceUpgrade, &v.Status, &v.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

func (r *OpsRepo) CreateAppVersion(ctx context.Context, v models.AppVersion) error {
	forceUpgrade := false
	if v.ForceUpgrade != nil {
		forceUpgrade = *v.ForceUpgrade
	}
	_, err := r.DB.Exec(ctx, `
		INSERT INTO app_versions(platform, version, description, download_url, force_upgrade)
		VALUES($1,$2,$3,$4,$5)`, v.Platform, v.Version, v.Description, v.DownloadURL, forceUpgrade)
	return err
}

func (r *OpsRepo) UpdateAppVersion(ctx context.Context, id string, v models.AppVersion) error {
	_, err := r.DB.Exec(ctx, `
		UPDATE app_versions SET
			description=COALESCE(NULLIF($2,''), description),
			download_url=COALESCE(NULLIF($3,''), download_url),
			force_upgrade=COALESCE($4, force_upgrade)
		WHERE id=$1::uuid`, id, v.Description, v.DownloadURL, v.ForceUpgrade)
	return err
}

func (r *OpsRepo) SetAppVersionStatus(ctx context.Context, id, status string) error {
	_, err := r.DB.Exec(ctx, `UPDATE app_versions SET status=$2 WHERE id=$1::uuid`, id, status)
	return err
}

// ===== 协议文档 =====

func (r *OpsRepo) ListLegalDocuments(ctx context.Context) ([]models.LegalDocument, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT id::text, type, version, language, title, content_url, status, published_at
		FROM legal_documents ORDER BY type, version DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]models.LegalDocument, 0)
	for rows.Next() {
		var d models.LegalDocument
		if err := rows.Scan(&d.ID, &d.Type, &d.Version, &d.Language, &d.Title, &d.ContentURL, &d.Status, &d.PublishedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, nil
}

func (r *OpsRepo) CreateLegalDocument(ctx context.Context, req models.LegalDocumentRequest) (string, error) {
	var id string
	err := r.DB.QueryRow(ctx, `
		INSERT INTO legal_documents(type, version, language, title, content_url)
		VALUES($1,$2,$3,$4,$5) RETURNING id::text`,
		req.Type, req.Version, req.Language, req.Title, req.ContentURL).Scan(&id)
	return id, err
}

func (r *OpsRepo) PublishLegalDocument(ctx context.Context, id string) error {
	_, err := r.DB.Exec(ctx, `
		UPDATE legal_documents SET status='published', published_at=NOW() WHERE id=$1::uuid`, id)
	return err
}

// ===== 举报原因 =====

func (r *OpsRepo) ListReportReasons(ctx context.Context) ([]models.ReportReason, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT id::text, target_type, reason, language, sort_order, status
		FROM report_reasons ORDER BY target_type, sort_order`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]models.ReportReason, 0)
	for rows.Next() {
		var x models.ReportReason
		if err := rows.Scan(&x.ID, &x.TargetType, &x.Reason, &x.Language, &x.SortOrder, &x.Status); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, nil
}

func (r *OpsRepo) CreateReportReason(ctx context.Context, x models.ReportReason) error {
	_, err := r.DB.Exec(ctx, `
		INSERT INTO report_reasons(target_type, reason, language, sort_order, status)
		VALUES($1,$2,$3,$4,$5)`, x.TargetType, x.Reason, x.Language, x.SortOrder, x.Status)
	return err
}

func (r *OpsRepo) UpdateReportReason(ctx context.Context, id string, x models.ReportReason) error {
	_, err := r.DB.Exec(ctx, `
		UPDATE report_reasons SET
			target_type=COALESCE(NULLIF($2,''),target_type), reason=COALESCE(NULLIF($3,''),reason),
			language=COALESCE(NULLIF($4,''),language), sort_order=COALESCE(NULLIF($5,0),sort_order)
		WHERE id=$1::uuid`, id, x.TargetType, x.Reason, x.Language, x.SortOrder)
	return err
}

func (r *OpsRepo) SetReportReasonStatus(ctx context.Context, id, status string) error {
	_, err := r.DB.Exec(ctx, `UPDATE report_reasons SET status=$2 WHERE id=$1::uuid`, id, status)
	return err
}

// ===== 系统限制（存 app_configs + app_config_versions，草稿→发布） =====

const cfgKeySystemLimits = "system.limits"

func defaultLimits() *models.SystemLimits {
	return &models.SystemLimits{MaxFileSizeMB: 20, MaxGroupMembers: 500, DefaultGroupMaxMembers: 200, RecallWindowSec: 120, MaxForwardTargets: 10000, MaxNicknameLen: 32}
}

func (r *OpsRepo) GetSystemLimits(ctx context.Context) (*models.SystemLimits, error) {
	l := defaultLimits()
	var raw string
	if err := r.DB.QueryRow(ctx, `SELECT value FROM app_configs WHERE key=$1`, cfgKeySystemLimits).Scan(&raw); err == nil && raw != "" {
		_ = json.Unmarshal([]byte(raw), l)
	}
	return l, nil
}

func (r *OpsRepo) SaveSystemLimits(ctx context.Context, l *models.SystemLimits, operatorID string) error {
	b, _ := json.Marshal(l)
	_, err := r.DB.Exec(ctx, `
		INSERT INTO app_configs(key, value, description, updated_by, updated_at)
		VALUES($1,$2,'系统限制草稿',$3::uuid,NOW())
		ON CONFLICT (key) DO UPDATE SET value=$2, updated_by=$3::uuid, updated_at=NOW()`,
		cfgKeySystemLimits, string(b), operatorID)
	return err
}

func (r *OpsRepo) GroupLimitImpact(ctx context.Context, limit int) (models.GroupLimitImpact, error) {
	var result models.GroupLimitImpact
	err := r.DB.QueryRow(ctx, `SELECT
		COUNT(*) FILTER (WHERE COALESCE(g.max_members,200)>$1),
		COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id=g.id)>$1)
		FROM groups g WHERE COALESCE(g.status,'active')='active'`, limit).Scan(
		&result.ConfiguredAboveLimit, &result.CurrentlyOverLimit)
	return result, err
}

// ===== 功能开关（feature.flags） =====

const cfgKeyFeatureFlags = "feature.flags"

func defaultFeatureFlags() *models.FeatureFlags {
	return &models.FeatureFlags{MFA: true, Report: true}
}

func (r *OpsRepo) GetFeatureFlags(ctx context.Context) (*models.FeatureFlags, error) {
	f := defaultFeatureFlags()
	var raw string
	if err := r.DB.QueryRow(ctx, `SELECT value FROM app_configs WHERE key=$1`, cfgKeyFeatureFlags).Scan(&raw); err == nil && raw != "" {
		_ = json.Unmarshal([]byte(raw), f)
	}
	return f, nil
}

func (r *OpsRepo) SaveFeatureFlags(ctx context.Context, flags *models.FeatureFlags, operatorID string) error {
	b, _ := json.Marshal(flags)
	_, err := r.DB.Exec(ctx, `
		INSERT INTO app_configs(key, value, description, updated_by, updated_at)
		VALUES($1,$2,'功能开关',$3::uuid,NOW())
		ON CONFLICT (key) DO UPDATE SET value=$2, updated_by=$3::uuid, updated_at=NOW()`,
		cfgKeyFeatureFlags, string(b), operatorID)
	return err
}

func (r *OpsRepo) PublishSystemLimits(ctx context.Context, operatorID string) error {
	var raw string
	if err := r.DB.QueryRow(ctx, `SELECT value FROM app_configs WHERE key=$1`, cfgKeySystemLimits).Scan(&raw); err != nil {
		return err
	}
	_, err := r.DB.Exec(ctx, `
		INSERT INTO app_config_versions(version, data_json, status, published_at, created_by)
		SELECT COALESCE(MAX(version),0)+1, $1, 'published', NOW(), $2::uuid
		FROM app_config_versions`, raw, operatorID)
	return err
}
