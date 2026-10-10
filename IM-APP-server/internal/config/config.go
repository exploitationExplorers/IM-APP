package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	HTTPAddr             string
	DatabaseURL          string
	JWTSecret            string
	DevSMSCode           string
	RedisURL             string
	MinIO                MinIOConfig
	OpenIM               OpenIMConfig
	IMInternalAPIKey     string
	LegacyChatEnabled    bool
	GroupMemberHardLimit int
	// GroupMemberMax / DefaultGroupMaxMembers 非 0 时，覆盖「管理后台发布的」群成员上限。
	//
	// 群的实际上限 = min(groups.max_members, maxGroupMembers, GroupMemberHardLimit)。
	// 正常情况下 maxGroupMembers / defaultGroupMaxMembers 由管理后台「系统限制」页
	// 保存并发布（存在 app_config_versions，只认 status='published'）。
	// 后台没部署、或不想走发布流程时，用这两个环境变量直接把上限钉住；
	// 设了之后管理后台再改也不影响线上，想交回后台托管就把变量去掉。
	GroupMemberMax         int
	DefaultGroupMaxMembers int
	SeedDemo               bool
	Kafka                  KafkaConfig
	Forward                ForwardConfig
	SMS                    SMSConfig
	CORSAllowOrigins       []string // 允许跨域的前端域名白名单；为空时回退为通配 *（仅建议本地开发）
	SMSRate                SMSRateConfig
}

// SMSRateConfig 设备指纹 + 多维度验证码限流配置
//
// 取向是「节流」而不是「封禁」：真正防刷的是「同一手机号 N 秒只能发一条」，
// 那一维卡住就挡住了重复刷；指纹 / DeviceID 只是兜底，阈值放宽即可，
// 免得 NAT、校园网、运营商大内网下大量正常用户共用出口 IP 被误伤。
//
// 刻意不设次数配额（原来有「每 IP 5 次/小时」「每手机号 10 次/天」，已去掉）。
// 任一维度配成 0 或负数即关闭该维度（见 infra.Redis.AllowKey）。
type SMSRateConfig struct {
	PhoneMinIntervalSeconds int  // 同一手机号两次发送的最小间隔(秒)，默认 60
	FingerprintLimit        int  // 每设备指纹每小时上限，默认 30
	FingerprintWindow       int  // 指纹限流窗口(秒)，默认 3600
	DeviceIDLimit           int  // 每客户端 DeviceID 每小时上限，默认 20
	DeviceIDWindow          int  // DeviceID 限流窗口(秒)，默认 3600
	IPMaxFingerprints       int  // 同 IP 每小时最大不同指纹数，超出判定设备农场；0=关闭（CGNAT 下默认关）
	IPFarmBlockSeconds      int  // 设备农场 IP 封禁时长(秒)，默认 600
	BlacklistEnabled        bool // 是否启用指纹/DeviceID 黑名单，默认 true
}

type MinIOConfig struct {
	Endpoint   string
	AccessKey  string
	SecretKey  string
	Bucket     string
	UseSSL     bool
	PublicURL  string // 对外可访问的 MinIO 地址（如 https://www.ke58.com/minio），空则用内部 Endpoint
	PublicRead bool   // true 时启动自动把桶设为公开读（外网可直接访问文件 URL）
}

type OpenIMConfig struct {
	APIURL              string
	PublicAPIURL        string
	PublicWSURL         string
	Secret              string
	AdminUser           string
	WebhookSecret       string
	WebhookAllowCIDRs   []string
	RecallWindowSeconds int
}

type KafkaConfig struct {
	Brokers string
	Topic   string
	GroupID string
}

type ForwardConfig struct {
	WorkerEnabled bool
	BatchSize     int
	MaxAttempts   int
	Concurrency   int
	QPS           int
	PollSeconds   int
	LockSeconds   int
}

// SMSConfig 阿里云短信服务（Dysmsapi SendSms）
type SMSConfig struct {
	AccessKeyID     string // 阿里云 AccessKey
	AccessKeySecret string
	SignName        string // 短信签名（阿里云控制台申请）
	TemplateCode    string // 短信模板 Code
	RegionID        string // 默认 cn-hangzhou
}

func Load() Config {
	loadDotEnv(".env")

	return Config{
		HTTPAddr:               getenv("HTTP_ADDR", ":8080"),
		DatabaseURL:            getenv("DATABASE_URL", "postgres://im:im123456@127.0.0.1:5433/im_app?sslmode=disable"),
		JWTSecret:              getenv("JWT_SECRET", "im-local-dev-secret-change-me"),
		IMInternalAPIKey:       getenv("IM_INTERNAL_API_KEY", ""),
		LegacyChatEnabled:      getenvBool("LEGACY_CHAT_ENABLED", false),
		GroupMemberHardLimit:   boundedPositiveInt("GROUP_MEMBER_HARD_LIMIT", 4000),
		GroupMemberMax:         optionalPositiveInt("GROUP_MEMBER_MAX"),
		DefaultGroupMaxMembers: optionalPositiveInt("DEFAULT_GROUP_MAX_MEMBERS"),
		SeedDemo:               getenvBool("SEED_DEMO", false),
		DevSMSCode:             getenv("DEV_SMS_CODE", ""),
		RedisURL:               getenv("REDIS_URL", ""),
		MinIO: MinIOConfig{
			Endpoint:   getenv("MINIO_ENDPOINT", ""),
			AccessKey:  getenv("MINIO_ACCESS_KEY", "minioadmin"),
			SecretKey:  getenv("MINIO_SECRET_KEY", "minioadmin123"),
			Bucket:     getenv("MINIO_BUCKET", "im-uploads"),
			UseSSL:     getenv("MINIO_USE_SSL", "false") == "true",
			PublicURL:  getenv("MINIO_PUBLIC_URL", ""),
			PublicRead: getenv("MINIO_PUBLIC_READ", "false") == "true",
		},
		OpenIM: OpenIMConfig{
			APIURL:              getenv("OPENIM_API_URL", ""),
			PublicAPIURL:        getenv("OPENIM_PUBLIC_API_URL", ""),
			PublicWSURL:         getenv("OPENIM_PUBLIC_WS_URL", ""),
			Secret:              getenv("OPENIM_SECRET", ""),
			AdminUser:           getenv("OPENIM_ADMIN_USER", "imAdmin"),
			WebhookSecret:       getenv("OPENIM_WEBHOOK_SECRET", ""),
			WebhookAllowCIDRs:   splitCSV(getenv("OPENIM_WEBHOOK_ALLOW_CIDRS", "")),
			RecallWindowSeconds: GetenvInt("OPENIM_RECALL_WINDOW_SECONDS", 120),
		},
		Kafka: KafkaConfig{
			Brokers: getenv("KAFKA_BROKERS", ""),
			Topic:   getenv("KAFKA_FORWARD_TOPIC", "im-forward-tasks"),
			GroupID: getenv("KAFKA_FORWARD_GROUP_ID", "im-forward-workers"),
		},
		Forward: ForwardConfig{
			WorkerEnabled: getenvBool("FORWARD_WORKER_ENABLED", true),
			BatchSize:     GetenvInt("FORWARD_BATCH_SIZE", 50),
			MaxAttempts:   GetenvInt("FORWARD_MAX_ATTEMPTS", 8),
			Concurrency:   GetenvInt("FORWARD_CONCURRENCY", 4),
			QPS:           GetenvInt("FORWARD_QPS", 20),
			PollSeconds:   GetenvInt("FORWARD_POLL_SECONDS", 2),
			LockSeconds:   GetenvInt("FORWARD_LOCK_SECONDS", 300),
		},
		SMS: SMSConfig{
			AccessKeyID:     getenv("ALIYUN_ACCESS_KEY_ID", ""),
			AccessKeySecret: getenv("ALIYUN_ACCESS_KEY_SECRET", ""),
			SignName:        getenv("SMS_SIGN_NAME", ""),
			TemplateCode:    getenv("SMS_TEMPLATE_CODE", ""),
			RegionID:        getenv("SMS_REGION_ID", "cn-hangzhou"),
		},
		CORSAllowOrigins: splitCSV(getenv("CORS_ALLOW_ORIGINS", "")),
		SMSRate: SMSRateConfig{
			PhoneMinIntervalSeconds: GetenvInt("SMS_PHONE_MIN_INTERVAL", 60),
			FingerprintLimit:        GetenvInt("SMS_FP_LIMIT", 30),
			FingerprintWindow:       GetenvInt("SMS_FP_WINDOW", 3600),
			DeviceIDLimit:           GetenvInt("SMS_DEVICE_LIMIT", 20),
			DeviceIDWindow:          GetenvInt("SMS_DEVICE_WINDOW", 3600),
			// 默认关闭「IP 农场」：运营商 CGNAT 下同公网 IP 会有大量真实用户，开大会误杀新用户。
			IPMaxFingerprints:  GetenvInt("SMS_IP_MAX_FPS", 0),
			IPFarmBlockSeconds: GetenvInt("SMS_IP_FARM_BLOCK_SEC", 600),
			BlacklistEnabled:   getenvBool("SMS_BLACKLIST_ENABLED", true),
		},
	}
}

func boundedPositiveInt(key string, fallback int) int {
	n := GetenvInt(key, fallback)
	if n < 3 {
		return fallback
	}
	return n
}

// optionalPositiveInt 未设置（或值不合法/小于 3）时返回 0，表示「不覆盖」。
// 用于那些「设了才生效、不设就走别处的值」的开关型配置。
func optionalPositiveInt(key string) int {
	n := GetenvInt(key, 0)
	if n < 3 {
		return 0
	}
	return n
}

// loadDotEnv 读取工作目录下的 .env，让 `go run ./cmd/server` 与 README 描述一致。
// 已存在的进程环境变量优先，docker compose 注入的值不会被文件覆盖。
func loadDotEnv(path string) {
	content, err := os.ReadFile(path)
	if err != nil {
		return
	}

	for _, raw := range strings.Split(string(content), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(strings.TrimPrefix(key, "\ufeff"))
		if key == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); exists {
			continue
		}
		_ = os.Setenv(key, strings.Trim(strings.TrimSpace(value), `"'`))
	}
}

func getenvBool(key string, fallback bool) bool {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(v)
	if err != nil {
		return fallback
	}
	return parsed
}

func splitCSV(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if item := strings.TrimSpace(part); item != "" {
			out = append(out, item)
		}
	}
	return out
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func GetenvInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}
