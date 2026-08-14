package service

import (
	"context"

	"im-app-admin/internal/models"
)

// ===== 国家与短信（清单 07） =====

func (s *OpsService) ListCountries(ctx context.Context) ([]models.Country, error) {
	return s.Repo.ListCountries(ctx)
}

func (s *OpsService) CreateCountry(ctx context.Context, c models.Country) error {
	return s.Repo.CreateCountry(ctx, c)
}

func (s *OpsService) UpdateCountryEnabled(ctx context.Context, code string, enabled bool) error {
	return s.Repo.UpdateCountryEnabled(ctx, code, enabled)
}

func (s *OpsService) ListSmsLogs(ctx context.Context, keyword, status string, page, size int) ([]models.SmsLog, int64, error) {
	return s.Repo.ListSmsLogs(ctx, keyword, status, size, (page-1)*size)
}

func (s *OpsService) GetSmsLog(ctx context.Context, id int64) (*models.SmsLog, error) {
	return s.Repo.GetSmsLog(ctx, id)
}

func (s *OpsService) SmsStatistics(ctx context.Context, days int) (*models.SmsStatistics, error) {
	return s.Repo.SmsStatistics(ctx, days)
}

func (s *OpsService) ProviderHealth(ctx context.Context) ([]models.ProviderHealth, error) {
	return s.Repo.ProviderHealth(ctx)
}
