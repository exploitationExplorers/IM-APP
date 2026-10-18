package config

import (
	"fmt"
	"net/url"
)

// ValidateEnvironment executes before connecting or running automatic migrations.
// Normal installations keep their existing configuration behavior.
func (c Config) ValidateEnvironment() error {
	if c.AppEnvironment != "oss-test" {
		return nil
	}
	u, err := url.Parse(c.DatabaseURL)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") ||
		u.User == nil || u.User.Username() != "im_oss_test" || u.Path != "/imapp_oss_test" ||
		(u.Host != "postgres:5432" && u.Host != "127.0.0.1:15433" && u.Host != "localhost:15433") {
		return fmt.Errorf("oss-test admin requires the isolated imapp_oss_test database and im_oss_test role")
	}
	q, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return fmt.Errorf("invalid oss-test admin database query")
	}
	for key := range q {
		if key != "sslmode" && key != "connect_timeout" {
			return fmt.Errorf("unsupported oss-test admin database query option")
		}
	}
	if c.ServerBaseURL != "http://api:8080" && c.ServerBaseURL != "http://127.0.0.1:18080" && c.ServerBaseURL != "http://localhost:18080" {
		return fmt.Errorf("oss-test admin requires the isolated business API")
	}
	if len(c.ServerInternalKey) < 32 || len(c.AdminJWTSecret) < 32 {
		return fmt.Errorf("oss-test admin requires independent strong test secrets")
	}
	return nil
}
