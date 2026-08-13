package repository

import (
	"context"

	"im-app-admin/internal/models"
)

// ===== 运行错误 / 导出（清单 10） =====

func (r *OpsRepo) ListErrorEvents(ctx context.Context, page, size int) ([]models.ErrorEvent, int64, error) {
	var total int64
	if err := r.DB.QueryRow(ctx, `SELECT COUNT(*) FROM system_error_events`).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := r.DB.Query(ctx, `
		SELECT id, service, level, message, fingerprint, count, first_at, last_at
		FROM system_error_events ORDER BY last_at DESC LIMIT $1 OFFSET $2`, size, (page-1)*size)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]models.ErrorEvent, 0)
	for rows.Next() {
		var e models.ErrorEvent
		if err := rows.Scan(&e.ID, &e.Service, &e.Level, &e.Message, &e.Fingerprint, &e.Count, &e.FirstAt, &e.LastAt); err != nil {
			return nil, 0, err
		}
		out = append(out, e)
	}
	return out, total, nil
}

func (r *OpsRepo) GetErrorEvent(ctx context.Context, id int64) (*models.ErrorEvent, error) {
	var e models.ErrorEvent
	err := r.DB.QueryRow(ctx, `
		SELECT id, service, level, message, fingerprint, count, first_at, last_at
		FROM system_error_events WHERE id=$1`, id).Scan(&e.ID, &e.Service, &e.Level, &e.Message, &e.Fingerprint, &e.Count, &e.FirstAt, &e.LastAt)
	if err != nil {
		return nil, err
	}
	return &e, nil
}

func (r *OpsRepo) CreateExportJob(ctx context.Context, resource, filters, creatorID string) (string, error) {
	var id string
	err := r.DB.QueryRow(ctx, `
		INSERT INTO export_jobs(resource, filters, created_by) VALUES($1,$2,$3::uuid) RETURNING id::text`,
		resource, filters, creatorID).Scan(&id)
	return id, err
}

func (r *OpsRepo) ListExportJobs(ctx context.Context, creatorID string, page, size int) ([]models.ExportJob, int64, error) {
	where := ""
	args := []any{creatorID}
	if creatorID != "" {
		where = " WHERE created_by=$1::uuid"
	}
	var total int64
	if err := r.DB.QueryRow(ctx, `SELECT COUNT(*) FROM export_jobs`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	qargs := append(append([]any{}, args...), size, (page-1)*size)
	rows, err := r.DB.Query(ctx, `
		SELECT id::text, resource, filters, status, file_url, created_at, finished_at, expires_at
		FROM export_jobs`+where+` ORDER BY created_at DESC LIMIT $2 OFFSET $3`, qargs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]models.ExportJob, 0)
	for rows.Next() {
		var j models.ExportJob
		if err := rows.Scan(&j.ID, &j.Resource, &j.Filters, &j.Status, &j.FileURL, &j.CreatedAt, &j.FinishedAt, &j.ExpiresAt); err != nil {
			return nil, 0, err
		}
		out = append(out, j)
	}
	return out, total, nil
}
