package config

import "fmt"

// ValidateMigrations runs before connecting to a database. The existing startup
// path stays available; an OSS production cutover must use reviewed, separate DDL.
func (c Config) ValidateMigrations() error {
	if c.MigrationsMode != "" && c.MigrationsMode != "auto" && c.MigrationsMode != "verify" {
		return fmt.Errorf("MIGRATIONS_MODE must be auto or verify")
	}
	if c.AppEnvironment == "oss-production" {
		if c.MigrationsMode != "verify" {
			return fmt.Errorf("oss-production requires MIGRATIONS_MODE=verify; apply only reviewed incremental DDL separately")
		}
		if c.SeedDemo {
			return fmt.Errorf("oss-production requires SEED_DEMO=false")
		}
	}
	return nil
}
