package repository

import (
	"context"

	"im-app-admin/internal/models"
	"im-app-admin/internal/util"
)

// ===== 国家与短信（清单 07） =====

func (r *OpsRepo) ListCountries(ctx context.Context) ([]models.Country, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT code, dial_code, cn_name, en_name, phone_rule, enabled, sort_order
		FROM countries ORDER BY sort_order, code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]models.Country, 0)
	for rows.Next() {
		var c models.Country
		if err := rows.Scan(&c.Code, &c.DialCode, &c.CNName, &c.ENName, &c.PhoneRule, &c.Enabled, &c.SortOrder); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}

func (r *OpsRepo) CreateCountry(ctx context.Context, c models.Country) error {
	_, err := r.DB.Exec(ctx, `
		INSERT INTO countries(code, dial_code, cn_name, en_name, phone_rule, enabled, sort_order)
		VALUES($1,$2,$3,$4,$5,$6,$7)`, c.Code, c.DialCode, c.CNName, c.ENName, c.PhoneRule, c.Enabled, c.SortOrder)
	return err
}

func (r *OpsRepo) UpdateCountryEnabled(ctx context.Context, code string, enabled bool) error {
	_, err := r.DB.Exec(ctx, `UPDATE countries SET enabled=$2 WHERE code=$1`, code, enabled)
	return err
}

func (r *OpsRepo) ListSmsLogs(ctx context.Context, keyword, status string, limit, offset int) ([]models.SmsLog, int64, error) {
	where := ""
	args := make([]any, 0)
	if status != "" && status != "all" {
		args = append(args, status)
		where += " AND status=$" + itoa(len(args))
	}
	if keyword != "" {
		args = append(args, "%"+keyword+"%")
		where += " AND phone_e164 ILIKE $" + itoa(len(args))
	}
	var total int64
	if err := r.DB.QueryRow(ctx, "SELECT COUNT(*) FROM sms_send_logs WHERE 1=1"+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	qargs := append(append([]any{}, args...), limit, offset)
	rows, err := r.DB.Query(ctx, `
		SELECT id, phone_e164, country_code, scene, status, error_code, provider, created_at
		FROM sms_send_logs WHERE 1=1`+where+`
		ORDER BY created_at DESC LIMIT $`+itoa(len(qargs)-1)+` OFFSET $`+itoa(len(qargs)), qargs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]models.SmsLog, 0)
	for rows.Next() {
		var l models.SmsLog
		if err := rows.Scan(&l.ID, &l.PhoneMasked, &l.CountryCode, &l.Scene, &l.Status,
			&l.ErrorCode, &l.Provider, &l.CreatedAt); err != nil {
			return nil, 0, err
		}
		l.PhoneMasked = util.MaskPhone(l.PhoneMasked)
		out = append(out, l)
	}
	return out, total, nil
}

func (r *OpsRepo) GetSmsLog(ctx context.Context, id int64) (*models.SmsLog, error) {
	var l models.SmsLog
	err := r.DB.QueryRow(ctx, `
		SELECT id, phone_e164, country_code, scene, status, error_code, provider, created_at
		FROM sms_send_logs WHERE id=$1`, id).Scan(&l.ID, &l.PhoneMasked, &l.CountryCode, &l.Scene, &l.Status, &l.ErrorCode, &l.Provider, &l.CreatedAt)
	if err != nil {
		return nil, err
	}
	l.PhoneMasked = util.MaskPhone(l.PhoneMasked)
	return &l, nil
}

func (r *OpsRepo) SmsStatistics(ctx context.Context, days int) (*models.SmsStatistics, error) {
	st := &models.SmsStatistics{}
	if err := r.DB.QueryRow(ctx, `
		SELECT COUNT(*),
		       COALESCE(SUM(CASE WHEN status='sent' OR status='success' THEN 1 ELSE 0 END),0),
		       COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END),0)
		FROM sms_send_logs WHERE created_at >= NOW() - ($1 || ' days')::interval`, days).Scan(&st.Total, &st.Success, &st.Failed); err != nil {
		return nil, err
	}
	if st.Total > 0 {
		st.Rate = float64(st.Success) / float64(st.Total) * 100
	}
	rows, err := r.DB.Query(ctx, `
		SELECT to_char(created_at, 'YYYY-MM-DD') AS d,
		       COUNT(*),
		       COALESCE(SUM(CASE WHEN status='sent' OR status='success' THEN 1 ELSE 0 END),0),
		       COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END),0)
		FROM sms_send_logs WHERE created_at >= NOW() - ($1 || ' days')::interval
		GROUP BY d ORDER BY d`, days)
	if err != nil {
		return st, nil
	}
	defer rows.Close()
	for rows.Next() {
		var p models.SmsStatPoint
		if rows.Scan(&p.Date, &p.Total, &p.Success, &p.Failed) == nil {
			st.ByDate = append(st.ByDate, p)
		}
	}
	return st, nil
}

func (r *OpsRepo) ProviderHealth(ctx context.Context) ([]models.ProviderHealth, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT provider, COUNT(*) AS total,
		       COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END),0) AS failed
		FROM sms_send_logs WHERE created_at >= NOW() - interval '1 day'
		GROUP BY provider`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]models.ProviderHealth, 0)
	for rows.Next() {
		var h models.ProviderHealth
		var total, failed int64
		if rows.Scan(&h.Provider, &total, &failed) == nil {
			h.Healthy = failed == 0
			out = append(out, h)
		}
	}
	return out, nil
}
