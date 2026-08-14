package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"im-app-server/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrReportReasonNotFound  = errors.New("report reason not found")
	ErrReportTargetNotFound  = errors.New("report target not found")
	ErrReportEvidenceInvalid = errors.New("report evidence invalid")
)

type ReportRepo struct {
	DB *pgxpool.Pool
}

func (r *ReportRepo) ListReasons(ctx context.Context, targetType, language string) ([]models.ReportReason, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT id::text, target_type, reason, language, sort_order
		FROM report_reasons
		WHERE target_type=$1 AND language=$2 AND status='active'
		ORDER BY sort_order, created_at, id`, targetType, language)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]models.ReportReason, 0)
	for rows.Next() {
		var item models.ReportReason
		if err := rows.Scan(&item.ID, &item.TargetType, &item.Reason, &item.Language, &item.SortOrder); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (r *ReportRepo) CreateUserReport(
	ctx context.Context,
	reporterID string,
	req models.CreateReportRequest,
) (models.ReportResult, error) {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return models.ReportResult{}, err
	}
	defer tx.Rollback(ctx)

	lockKey := reporterID + ":user:" + req.TargetID
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, lockKey); err != nil {
		return models.ReportResult{}, err
	}

	if existing, found, err := findOpenReport(ctx, tx, reporterID, req.TargetID); err != nil {
		return models.ReportResult{}, err
	} else if found {
		if err := tx.Commit(ctx); err != nil {
			return models.ReportResult{}, err
		}
		return existing, nil
	}

	var targetExists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id=$1::uuid)`, req.TargetID).Scan(&targetExists); err != nil {
		return models.ReportResult{}, err
	}
	if !targetExists {
		return models.ReportResult{}, ErrReportTargetNotFound
	}

	var reasonText string
	if err := tx.QueryRow(ctx, `
		SELECT reason FROM report_reasons
		WHERE id=$1::uuid AND target_type='user' AND status='active'`, req.ReasonID).Scan(&reasonText); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.ReportResult{}, ErrReportReasonNotFound
		}
		return models.ReportResult{}, err
	}

	files, err := loadReportEvidence(ctx, tx, reporterID, req.EvidenceFileIDs)
	if err != nil {
		return models.ReportResult{}, err
	}

	reportNo := "REP" + time.Now().UTC().Format("20060102") + uuid.NewString()[:12]
	var result models.ReportResult
	var createdAt time.Time
	err = tx.QueryRow(ctx, `
		INSERT INTO reports(
			report_no, reporter_id, target_type, target_id, reason_id,
			reason_text, description, status
		) VALUES($1,$2::uuid,'user',$3,$4::uuid,$5,$6,'pending')
		RETURNING id::text, status, created_at`,
		reportNo, reporterID, req.TargetID, req.ReasonID, reasonText, req.Description,
	).Scan(&result.ID, &result.Status, &createdAt)
	if err != nil {
		return models.ReportResult{}, err
	}

	for _, file := range files {
		if _, err := tx.Exec(ctx, `
			INSERT INTO report_files(report_id, file_id, file_url, content_type)
			VALUES($1::uuid,$2::uuid,$3,$4)`, result.ID, file.ID, file.URL, file.ContentType); err != nil {
			return models.ReportResult{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return models.ReportResult{}, err
	}
	result.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	return result, nil
}

func findOpenReport(
	ctx context.Context,
	tx pgx.Tx,
	reporterID, targetID string,
) (models.ReportResult, bool, error) {
	var result models.ReportResult
	var createdAt time.Time
	err := tx.QueryRow(ctx, `
		SELECT id::text, status, created_at
		FROM reports
		WHERE reporter_id=$1::uuid AND target_type='user' AND target_id=$2
		  AND status IN ('pending','processing','reopened')
		ORDER BY created_at DESC LIMIT 1`, reporterID, targetID,
	).Scan(&result.ID, &result.Status, &createdAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return models.ReportResult{}, false, nil
	}
	if err != nil {
		return models.ReportResult{}, false, err
	}
	result.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	return result, true, nil
}

func loadReportEvidence(
	ctx context.Context,
	tx pgx.Tx,
	reporterID string,
	fileIDs []string,
) ([]models.FileObject, error) {
	files := make([]models.FileObject, 0, len(fileIDs))
	seen := make(map[string]struct{}, len(fileIDs))
	for _, fileID := range fileIDs {
		if _, duplicate := seen[fileID]; duplicate {
			continue
		}
		seen[fileID] = struct{}{}

		var file models.FileObject
		err := tx.QueryRow(ctx, `
			SELECT id::text, content_type, url
			FROM files
			WHERE id=$1::uuid AND owner_id=$2::uuid AND status='ready'`, fileID, reporterID,
		).Scan(&file.ID, &file.ContentType, &file.URL)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrReportEvidenceInvalid
		}
		if err != nil {
			return nil, fmt.Errorf("load report evidence: %w", err)
		}
		files = append(files, file)
	}
	return files, nil
}
