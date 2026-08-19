package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"im-app-admin/internal/models"
	"im-app-admin/internal/util"

	"github.com/jackc/pgx/v5"
)

// ===== 举报与内容处置（清单 05） =====

func scanReport(row pgx.Row) (models.Report, error) {
	var rp models.Report
	err := row.Scan(&rp.ID, &rp.ReportNo, &rp.ReporterID, &rp.TargetType, &rp.TargetID,
		&rp.ReasonText, &rp.Description, &rp.Status, &rp.AssigneeID, &rp.Conclusion,
		&rp.ActionTaken, &rp.CreatedAt, &rp.UpdatedAt)
	return rp, err
}

func (r *DataRepo) ListReports(ctx context.Context, status, targetType, keyword string, limit, offset int) ([]models.Report, int64, error) {
	where := ""
	args := make([]any, 0)
	if status != "" && status != "all" {
		args = append(args, status)
		where += " AND status=$" + itoa(len(args))
	}
	if targetType != "" && targetType != "all" {
		args = append(args, targetType)
		where += " AND target_type=$" + itoa(len(args))
	}
	if keyword != "" {
		args = append(args, "%"+keyword+"%")
		where += " AND (report_no ILIKE $" + itoa(len(args)) + " OR target_id ILIKE $" + itoa(len(args)) + ")"
	}
	var total int64
	if err := r.DB.QueryRow(ctx, "SELECT COUNT(*) FROM reports WHERE 1=1"+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	qargs := append(append([]any{}, args...), limit, offset)
	rows, err := r.DB.Query(ctx, `
		SELECT id::text, report_no, COALESCE(reporter_id::text,''), target_type, target_id,
		       reason_text, description, status, COALESCE(assignee_id::text,''),
		       COALESCE(conclusion,''), COALESCE(action_taken,''), created_at, updated_at
		FROM reports WHERE 1=1`+where+`
		ORDER BY created_at DESC LIMIT $`+itoa(len(qargs)-1)+` OFFSET $`+itoa(len(qargs)), qargs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]models.Report, 0)
	for rows.Next() {
		rp, err := scanReport(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, rp)
	}
	return out, total, nil
}

// CountResolvedReports 统计某对象被结案（成立）的举报数（举报联动用）
func (r *DataRepo) CountResolvedReports(ctx context.Context, targetType, targetID string) (int64, error) {
	var n int64
	err := r.DB.QueryRow(ctx, `
		SELECT COUNT(*) FROM reports
		WHERE target_type=$1 AND target_id=$2 AND status='resolved'`, targetType, targetID).Scan(&n)
	return n, err
}

func (r *DataRepo) GetReport(ctx context.Context, reportID string) (*models.ReportDetail, error) {
	rp, err := scanReport(r.DB.QueryRow(ctx, `
		SELECT id::text, report_no, COALESCE(reporter_id::text,''), target_type, target_id,
		       reason_text, description, status, COALESCE(assignee_id::text,''),
		       COALESCE(conclusion,''), COALESCE(action_taken,''), created_at, updated_at
		FROM reports WHERE id=$1::uuid`, reportID))
	if err != nil {
		return nil, err
	}
	d := &models.ReportDetail{Report: rp}
	fileRows, err := r.DB.Query(ctx, `
		SELECT id::text, file_url, content_type, message_id FROM report_files WHERE report_id=$1::uuid`, reportID)
	if err == nil {
		defer fileRows.Close()
		for fileRows.Next() {
			var f models.ReportFile
			if fileRows.Scan(&f.ID, &f.FileURL, &f.ContentType, &f.MessageID) == nil {
				d.Files = append(d.Files, f)
			}
		}
	}
	noteRows, err := r.DB.Query(ctx, `
		SELECT id, COALESCE(admin_id::text,''), content, created_at FROM report_notes WHERE report_id=$1::uuid ORDER BY created_at`, reportID)
	if err == nil {
		defer noteRows.Close()
		for noteRows.Next() {
			var n models.ReportNote
			if noteRows.Scan(&n.ID, &n.AdminID, &n.Content, &n.CreatedAt) == nil {
				d.Notes = append(d.Notes, n)
			}
		}
	}
	return d, nil
}

func (r *DataRepo) ListUserReports(ctx context.Context, userID string, limit, offset int) ([]models.Report, int64, error) {
	return r.ListReportsFiltered(ctx, "user", userID, limit, offset)
}

func (r *DataRepo) ListReportsFiltered(ctx context.Context, targetType, targetID string, limit, offset int) ([]models.Report, int64, error) {
	var total int64
	_ = r.DB.QueryRow(ctx, `SELECT COUNT(*) FROM reports WHERE target_type=$1 AND target_id=$2::text`, targetType, targetID).Scan(&total)
	rows, err := r.DB.Query(ctx, `
		SELECT id::text, report_no, COALESCE(reporter_id::text,''), target_type, target_id,
		       reason_text, description, status, COALESCE(assignee_id::text,''),
		       COALESCE(conclusion,''), COALESCE(action_taken,''), created_at, updated_at
		FROM reports WHERE target_type=$1 AND target_id=$2::text
		ORDER BY created_at DESC LIMIT $3 OFFSET $4`, targetType, targetID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]models.Report, 0)
	for rows.Next() {
		rp, err := scanReport(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, rp)
	}
	return out, total, nil
}

// CreateReportNo 生成举报编号
func (r *DataRepo) CreateReportNo() string {
	return "REP" + time.Now().UTC().Format("20060102") + util.RandomHex(3)
}

// CreateReport 创建举报（供其他模块调用）
func (r *DataRepo) CreateReport(ctx context.Context, reporterID, targetType, targetID, reasonText, description string) (string, error) {
	no := r.CreateReportNo()
	var id string
	err := r.DB.QueryRow(ctx, `
		INSERT INTO reports(report_no, reporter_id, target_type, target_id, reason_text, description)
		VALUES($1,$2::uuid,$3,$4,$5,$6) RETURNING id::text`,
		no, reporterID, targetType, targetID, reasonText, description).Scan(&id)
	return id, err
}

// transitionReport 状态机校验 + 乐观锁（version CAS）状态迁移（清单 05.4）
func (r *DataRepo) transitionReport(ctx context.Context, reportID, action, toStatus, detail, operatorID string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var before string
	var version int
	if err := tx.QueryRow(ctx, `SELECT status, version FROM reports WHERE id=$1::uuid FOR UPDATE`, reportID).Scan(&before, &version); err != nil {
		return err
	}
	// 状态机校验：禁止非法流转（终态不可再处理）
	if !validReportTransition(before, toStatus) {
		return fmt.Errorf("举报状态 %s 不能流转到 %s", before, toStatus)
	}
	tag, err := tx.Exec(ctx, `
		UPDATE reports SET status=$2, version=version+1, updated_at=NOW()
		WHERE id=$1::uuid AND version=$3`, reportID, toStatus, version)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("举报状态已变更，请刷新后重试")
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO report_actions(report_id, admin_id, action, before_status, after_status, detail)
		VALUES($1::uuid,$2::uuid,$3,$4,$5,$6)`,
		reportID, operatorID, action, before, toStatus, detail); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// validReportTransition 举报状态机合法流转：
// pending/reopened → processing（start）；pending/processing/reopened → resolved|rejected；rejected → reopened
func validReportTransition(before, to string) bool {
	switch to {
	case "processing":
		return before == "pending" || before == "reopened"
	case "resolved", "rejected":
		return before == "pending" || before == "processing" || before == "reopened"
	case "reopened":
		return before == "rejected"
	}
	return false
}

func (r *DataRepo) AssignReport(ctx context.Context, reportID, assigneeID, operatorID, reason string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE reports SET assignee_id=$2::uuid, updated_at=NOW() WHERE id=$1::uuid`, reportID, assigneeID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO report_assignments(report_id, assigner_id, assignee_id) VALUES($1::uuid,$2::uuid,$3::uuid)`,
		reportID, operatorID, assigneeID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO report_actions(report_id, admin_id, action, before_status, after_status, detail)
		VALUES($1::uuid,$2::uuid,'assign','', '', $3)`, reportID, operatorID, reason); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *DataRepo) StartReport(ctx context.Context, reportID, operatorID string) error {
	return r.transitionReport(ctx, reportID, "start", "processing", "开始处理", operatorID)
}

func (r *DataRepo) AddReportNote(ctx context.Context, reportID, operatorID, content string) error {
	_, err := r.DB.Exec(ctx, `
		INSERT INTO report_notes(report_id, admin_id, content) VALUES($1::uuid,$2::uuid,$3)`,
		reportID, operatorID, content)
	return err
}

func (r *DataRepo) ResolveReport(ctx context.Context, reportID string, conclusion, actionTaken, operatorID, reason string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var before string
	var version int
	if err := tx.QueryRow(ctx, `SELECT status, version FROM reports WHERE id=$1::uuid FOR UPDATE`, reportID).Scan(&before, &version); err != nil {
		return err
	}
	if !validReportTransition(before, "resolved") {
		return fmt.Errorf("举报状态 %s 不能结案", before)
	}
	tag, err := tx.Exec(ctx, `
		UPDATE reports SET status='resolved', conclusion=$2, action_taken=$3, resolved_by=$4::uuid, version=version+1, updated_at=NOW()
		WHERE id=$1::uuid AND version=$5`, reportID, conclusion, actionTaken, operatorID, version)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("举报状态已变更，请刷新后重试")
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO report_actions(report_id, admin_id, action, before_status, after_status, detail)
		VALUES($1::uuid,$2::uuid,'resolve',$3, 'resolved', $4)`, reportID, operatorID, before, reason); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *DataRepo) RejectReport(ctx context.Context, reportID, operatorID, reason string) error {
	return r.transitionReport(ctx, reportID, "reject", "rejected", reason, operatorID)
}

func (r *DataRepo) ReopenReport(ctx context.Context, reportID, operatorID, reason string) error {
	return r.transitionReport(ctx, reportID, "reopen", "reopened", reason, operatorID)
}

func (r *DataRepo) ListReportActions(ctx context.Context, reportID string) ([]models.ReportAction, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT id, COALESCE(admin_id::text,''), action, before_status, after_status, detail, created_at
		FROM report_actions WHERE report_id=$1::uuid ORDER BY created_at`, reportID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]models.ReportAction, 0)
	for rows.Next() {
		var a models.ReportAction
		if err := rows.Scan(&a.ID, &a.AdminID, &a.Action, &a.BeforeStatus, &a.AfterStatus, &a.Detail, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, nil
}
