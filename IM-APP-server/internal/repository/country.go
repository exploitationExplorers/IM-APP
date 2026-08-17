package repository

import (
	"context"

	"im-app-server/internal/models"

	"github.com/jackc/pgx/v5/pgxpool"
)

type CountryRepo struct{ DB *pgxpool.Pool }

// ListEnabled 返回启用的国家区号（登录前可用）
func (r *CountryRepo) ListEnabled(ctx context.Context) ([]models.CountryItem, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT code, dial_code, cn_name, en_name, enabled
		FROM countries WHERE enabled=true ORDER BY sort_order, code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]models.CountryItem, 0)
	for rows.Next() {
		var c models.CountryItem
		if err := rows.Scan(&c.Code, &c.DialCode, &c.CNName, &c.ENName, &c.Enabled); err != nil {
			return nil, err
		}
		list = append(list, c)
	}
	return list, nil
}
