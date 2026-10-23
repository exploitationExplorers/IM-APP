package config

import (
	"fmt"
	"net/url"
	"strings"
)

type OSSConfig struct {
	Region, Endpoint, PublicUploadURL                        string
	Bucket, AccessKeyID, AccessKeySecret, SessionToken       string
	KeyPrefix, PublicBaseURL, MediaProxyURL, MediaSigningKey string
}

// ValidateStorage runs before connecting to a database or applying migrations.
// OSS is the default. MinIO must be selected explicitly for legacy deployments.
func (c Config) ValidateStorage() error {
	provider := c.StorageBackend()
	if provider != "minio" && provider != "oss" {
		return fmt.Errorf("STORAGE_PROVIDER must be minio or oss")
	}
	if c.AppEnvironment == "oss-test" {
		u, err := url.Parse(c.DatabaseURL)
		if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Hostname() == "" || u.Path != "/imapp_oss_test" || u.User == nil || u.User.Username() != "im_oss_test" {
			return fmt.Errorf("oss-test requires the dedicated imapp_oss_test database and im_oss_test role")
		}
		if !testAddress(u.Host, "postgres:5432", "15433") {
			return fmt.Errorf("oss-test requires an isolated PostgreSQL endpoint")
		}
		// pgx accepts query overrides for host/user/dbname; do not let those
		// bypass the validated URL authority/path, or inherit a service profile.
		query, err := url.ParseQuery(u.RawQuery)
		if err != nil {
			return fmt.Errorf("invalid oss-test database query")
		}
		for key := range query {
			if key != "sslmode" && key != "connect_timeout" {
				return fmt.Errorf("unsupported oss-test database query option")
			}
		}
		if c.RedisURL != "" {
			r, err := url.Parse(c.RedisURL)
			if err != nil || r.Scheme != "redis" || !testAddress(r.Host, "redis:6379", "16379") {
				return fmt.Errorf("oss-test requires isolated business Redis")
			}
		}
		if c.MinIO.Endpoint != "" && (!testAddress(c.MinIO.Endpoint, "minio-source:9000", "19000") || c.MinIO.Bucket != "im-uploads-oss-test") {
			return fmt.Errorf("oss-test legacy MinIO must be the isolated test source")
		}
		if c.OpenIM.APIURL != "" {
			o, err := url.Parse(c.OpenIM.APIURL)
			if err != nil || o.Scheme != "http" || !testAddress(o.Host, "openim-api:10002", "11002") || o.User != nil || o.RawQuery != "" || o.Fragment != "" || (o.Path != "" && o.Path != "/") {
				return fmt.Errorf("oss-test requires isolated OpenIM API")
			}
		}
		if c.Kafka.Brokers != "" && (c.Kafka.Brokers != "kafka:19092" || c.Kafka.Topic != "im-forward-tasks_oss_test" || c.Kafka.GroupID != "im-forward-workers_oss_test") {
			return fmt.Errorf("oss-test requires isolated Kafka and test topics")
		}
		if c.SMS.SignName != "" || c.SMS.TemplateCode != "" {
			return fmt.Errorf("real SMS delivery must be disabled in oss-test")
		}
		if provider == "oss" && c.OSS.KeyPrefix != "oss-test/business/" {
			return fmt.Errorf("oss-test requires OSS_KEY_PREFIX=oss-test/business/")
		}
	}
	return nil
}

func storageProvider(raw string) string {
	provider := strings.ToLower(strings.TrimSpace(raw))
	if provider == "" {
		return "oss"
	}
	return provider
}

func (c Config) StorageBackend() string { return storageProvider(c.StorageProvider) }

func testAddress(address, internal, localPort string) bool {
	return address == internal || address == "127.0.0.1:"+localPort || address == "localhost:"+localPort
}
