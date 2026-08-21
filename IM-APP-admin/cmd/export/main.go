// 命令：生成管理后台 OpenAPI 3.0 规范文件（docs/admin-api.json），供 Apifox 等工具导入。
// 用法：cd IM-APP-admin && go run ./cmd/export
package main

import (
	"encoding/json"
	"log"
	"os"
	"strings"
	"time"

	"im-app-admin/internal/config"
	"im-app-admin/internal/handler"
	"im-app-admin/internal/middleware"
	"im-app-admin/internal/repository"
	"im-app-admin/internal/server"
	"im-app-admin/internal/service"

	"github.com/gin-gonic/gin"
)

func main() {
	cfg := config.Load()

	authRepo := &repository.AuthRepo{}
	rbacRepo := &repository.RBACRepo{}
	auditRepo := &repository.AuditRepo{}

	authSvc := &service.AuthService{
		Auth:       authRepo,
		Rbac:       rbacRepo,
		Audit:      auditRepo,
		Secret:     cfg.AdminJWTSecret,
		Issuer:     cfg.JWTIssuer,
		Audience:   cfg.JWTAudience,
		AccessTTL:  cfg.AccessTokenTTL,
		RefreshTTL: cfg.RefreshTokenTTL,
		MFATTL:     5 * time.Minute,
	}
	rbacSvc := &service.RBACService{Rbac: rbacRepo, Auth: authRepo, Audit: auditRepo}
	dataSvc := &service.DataService{Repo: &repository.DataRepo{}}
	opsSvc := &service.OpsService{Repo: &repository.OpsRepo{}}

	r := server.BuildRouter(server.Deps{
		Cfg:       cfg,
		RbacRepo:  rbacRepo,
		AuditRepo: auditRepo,
		AuthH:     &handler.AuthHandler{Svc: authSvc, Limiter: middleware.NewLoginLimiter(cfg.LoginFailThreshold, cfg.LoginLockMinutes)},
		RBACH:     &handler.RBACHandler{Svc: rbacSvc},
		DataH:     &handler.DataHandler{Data: dataSvc},
		OpsH:      &handler.OpsHandler{Svc: opsSvc},
		MetaH:     &handler.MetaHandler{Version: "1.0.0", Commit: "dev", Svc: opsSvc},
	})

	doc := buildOpenAPI(r.Routes())
	b, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		log.Fatalf("marshal: %v", err)
	}
	if err := os.MkdirAll("docs", 0o755); err != nil {
		log.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile("docs/admin-api.json", b, 0o644); err != nil {
		log.Fatalf("write: %v", err)
	}
	log.Printf("已生成 docs/admin-api.json（%d 个接口）", len(r.Routes()))
}

// ===== OpenAPI 生成 =====

func buildOpenAPI(routes gin.RoutesInfo) map[string]any {
	paths := map[string]any{}
	for _, rt := range routes {
		opath := openapiPath(rt.Path)
		method := strings.ToLower(rt.Method)
		summary := apiDescriptions[strings.ToUpper(method)+" "+opath]
		if summary == "" {
			summary = rt.Path
		}
		op := map[string]any{
			"tags":        []string{tagFor(rt.Path)},
			"summary":     summary,
			"operationId": opID(method, rt.Path),
		}
		if summary != rt.Path {
			op["description"] = summary + "。接口路径：" + rt.Path
		}
		if isPublic(rt.Path) {
			op["security"] = []any{} // 公共接口无需鉴权，覆盖全局 BearerAuth 声明
		}
		params := make([]any, 0)
		params = append(params, pathParams(rt.Path)...)
		params = append(params, queryParams(rt.Method, rt.Path)...)
		if len(params) > 0 {
			op["parameters"] = params
		}
		if rb := requestBody(rt.Method, rt.Path); rb != nil {
			op["requestBody"] = rb
		}
		op["responses"] = map[string]any{
			"200": map[string]any{"description": "成功", "content": map[string]any{
				"application/json": map[string]any{"schema": successResponseSchema(method, rt.Path)},
			}},
			"400": map[string]any{"description": "参数错误"},
			"401": map[string]any{"description": "未登录或登录已过期"},
			"403": map[string]any{"description": "无权限"},
			"500": map[string]any{"description": "服务异常"},
		}
		if paths[opath] == nil {
			paths[opath] = map[string]any{}
		}
		paths[opath].(map[string]any)[method] = op
	}
	return map[string]any{
		"openapi": "3.0.3",
		"info": map[string]any{
			"title":       "IM-APP 管理后台 API",
			"version":     "1.0.0",
			"description": "按《GOAL-管理后台分模块开发清单(1).md》实现。除 /health、/auth/login、/auth/mfa/verify、/auth/token/refresh 外，均需在请求头携带 `Authorization: Bearer <token>`。统一响应 `{code, message, data, requestId}`，code=0 成功；列表接口 data 为 `{items, total, page, pageSize}`。错误 message 为通用文案，底层详情仅记录在后端日志。",
		},
		"servers": []map[string]any{{"url": "http://localhost:8090/api/admin/v1"}},
		"tags":    buildTags(),
		"paths":   paths,
		"components": map[string]any{
			"securitySchemes": map[string]any{
				"BearerAuth": map[string]any{"type": "http", "scheme": "bearer", "bearerFormat": "JWT"},
			},
			"schemas": allSchemas(),
		},
		"security": []map[string]any{{"BearerAuth": []any{}}},
	}
}

// isPublic 判断是否为无需鉴权的公共接口
// /auth/token/refresh 只依赖 refresh token，鉴权组之外（access 过期后仍可续期）
func isPublic(p string) bool {
	return p == "/api/admin/v1/health" ||
		strings.HasSuffix(p, "/auth/login") ||
		strings.HasSuffix(p, "/auth/mfa/verify") ||
		strings.HasSuffix(p, "/auth/token/refresh")
}

// openapiPath /users/:id -> /users/{id}
func openapiPath(p string) string {
	segs := strings.Split(p, "/")
	for i, s := range segs {
		if strings.HasPrefix(s, ":") {
			segs[i] = "{" + strings.TrimPrefix(s, ":") + "}"
		}
	}
	return strings.Join(segs, "/")
}

func pathParams(p string) []any {
	out := make([]any, 0)
	for _, s := range strings.Split(p, "/") {
		if strings.HasPrefix(s, ":") {
			name := strings.TrimPrefix(s, ":")
			typ := "string"
			// 这些资源的 id 为 BIGSERIAL，handler 按 int64 解析（id64）
			if name == "id" && (strings.Contains(p, "/sms/logs/") || strings.Contains(p, "/system/errors/") || strings.Contains(p, "/audit-logs/")) {
				typ = "integer"
			}
			out = append(out, map[string]any{
				"name":        name,
				"in":          "path",
				"required":    true,
				"description": pathParamDesc(name),
				"schema":      map[string]any{"type": typ},
			})
		}
	}
	return out
}

func pathParamDesc(name string) string {
	switch name {
	case "id":
		return "资源 ID（UUID）"
	case "userId":
		return "用户 ID（UUID）"
	case "messageId":
		return "消息 ID（UUID）"
	case "code":
		return "国家/地区码（如 CN）"
	default:
		return "资源 ID"
	}
}

// queryParamSpec 单个 query 参数定义
type queryParamSpec struct {
	Name     string
	Type     string
	Required bool
	Desc     string
}

// queryParamSpecs 各接口的精确 query 参数（key = 方法 + OpenAPI 路径；仅列有 query 参数的接口）
var queryParamSpecs = map[string][]queryParamSpec{
	"GET /api/admin/v1/users": {
		{"page", "integer", false, "页码（默认1）"},
		{"size", "integer", false, "每页条数（默认20，最大100）"},
		{"keyword", "string", false, "关键字（按昵称/公共ID/手机号匹配）"},
		{"status", "string", false, "状态筛选：active|banned|cancelled"},
	},
	"GET /api/admin/v1/users/phone-search": {
		{"phone", "string", true, "完整手机号"},
		{"page", "integer", false, "页码（默认1）"},
		{"size", "integer", false, "每页条数（默认20，最大100）"},
	},
	"GET /api/admin/v1/admins": {
		{"page", "integer", false, "页码（默认1）"},
		{"size", "integer", false, "每页条数（默认20，最大100）"},
		{"keyword", "string", false, "关键字（按用户名/昵称匹配）"},
	},
	"GET /api/admin/v1/groups": {
		{"page", "integer", false, "页码（默认1）"},
		{"size", "integer", false, "每页条数（默认20，最大100）"},
		{"keyword", "string", false, "关键字（按群名/群ID匹配）"},
		{"status", "string", false, "状态筛选：normal|banned|dismissed|muted"},
	},
	"GET /api/admin/v1/reports": {
		{"page", "integer", false, "页码（默认1）"},
		{"size", "integer", false, "每页条数（默认20，最大100）"},
		{"keyword", "string", false, "关键字（按编号/目标匹配）"},
		{"status", "string", false, "状态筛选：pending|processing|resolved|rejected|reopened"},
		{"targetType", "string", false, "目标类型：user|group|message"},
	},
	"GET /api/admin/v1/audit-logs": {
		{"page", "integer", false, "页码（默认1）"},
		{"size", "integer", false, "每页条数（默认20，最大100）"},
		{"keyword", "string", false, "关键字（按管理员/动作/资源ID/IP匹配）"},
		{"result", "string", false, "结果：success|denied|failed"},
		{"resource", "string", false, "资源类型筛选"},
	},
	"GET /api/admin/v1/admin-login-logs": {
		{"page", "integer", false, "页码（默认1）"},
		{"size", "integer", false, "每页条数（默认20，最大100）"},
	},
	"GET /api/admin/v1/forward-tasks": {
		{"page", "integer", false, "页码（默认1）"},
		{"size", "integer", false, "每页条数（默认20，最大100）"},
		{"status", "string", false, "状态筛选：pending|processing|success|failed|cancelled"},
	},
	"GET /api/admin/v1/forward-tasks/{id}/targets": {
		{"page", "integer", false, "页码（默认1）"},
		{"size", "integer", false, "每页条数（默认20，最大100）"},
		{"status", "string", false, "状态筛选：pending|success|failed|skipped|cancelled"},
	},
	"GET /api/admin/v1/sms/logs": {
		{"page", "integer", false, "页码（默认1）"},
		{"size", "integer", false, "每页条数（默认20，最大100）"},
		{"keyword", "string", false, "关键字（按手机号匹配）"},
		{"status", "string", false, "状态筛选"},
	},
	"GET /api/admin/v1/users/{id}/reports": {
		{"page", "integer", false, "页码（默认1）"},
		{"size", "integer", false, "每页条数（默认20，最大100）"},
	},
	"GET /api/admin/v1/users/{id}/forward-tasks": {
		{"page", "integer", false, "页码（默认1）"},
		{"size", "integer", false, "每页条数（默认20，最大100）"},
	},
	"GET /api/admin/v1/groups/{id}/reports": {
		{"page", "integer", false, "页码（默认1）"},
		{"size", "integer", false, "每页条数（默认20，最大100）"},
	},
	"GET /api/admin/v1/groups/{id}/recall-logs": {
		{"page", "integer", false, "页码（默认1）"},
		{"size", "integer", false, "每页条数（默认20，最大100）"},
	},
	"GET /api/admin/v1/system/errors": {
		{"page", "integer", false, "页码（默认1）"},
		{"size", "integer", false, "每页条数（默认20，最大100）"},
	},
	"GET /api/admin/v1/exports": {
		{"page", "integer", false, "页码（默认1）"},
		{"size", "integer", false, "每页条数（默认20，最大100）"},
	},
	"GET /api/admin/v1/moderation/hits": {
		{"page", "integer", false, "页码（默认1）"},
		{"size", "integer", false, "每页条数（默认20，最大100）"},
	},
	"GET /api/admin/v1/moderation/profiles": {
		{"page", "integer", false, "页码（默认1）"},
		{"size", "integer", false, "每页条数（默认20，最大100）"},
		{"status", "string", false, "状态筛选：pending|rejected|restored"},
	},
	"GET /api/admin/v1/sensitive-words": {
		{"keyword", "string", false, "关键字（按敏感词匹配）"},
	},
	"GET /api/admin/v1/sms/statistics": {
		{"days", "integer", false, "统计天数（默认7）"},
	},
	"GET /api/admin/v1/dashboard/trends": {
		{"days", "integer", false, "趋势统计天数（默认7）"},
	},
}

// queryParams 按接口精确返回 query 参数（key = 方法 + OpenAPI 路径）
func queryParams(method, p string) []any {
	key := strings.ToUpper(method) + " " + openapiPath(p)
	specs, ok := queryParamSpecs[key]
	if !ok {
		return nil
	}
	out := make([]any, 0, len(specs))
	for _, s := range specs {
		out = append(out, param(s.Name, "query", s.Desc, s.Type, s.Required, queryParamEnums[key+" "+s.Name], enumDescs[key+" "+s.Name]))
	}
	return out
}

// queryParamEnums 各接口 query 参数的可选值（key = "方法 路径 参数名"）
var queryParamEnums = map[string][]string{
	"GET /api/admin/v1/users status":                      {"active", "banned", "cancelled"},
	"GET /api/admin/v1/groups status":                     {"normal", "banned", "dismissed", "muted"},
	"GET /api/admin/v1/reports status":                    {"pending", "processing", "resolved", "rejected", "reopened"},
	"GET /api/admin/v1/reports targetType":                {"user", "group", "message"},
	"GET /api/admin/v1/audit-logs result":                 {"success", "denied", "failed"},
	"GET /api/admin/v1/forward-tasks status":              {"pending", "processing", "success", "failed", "cancelled"},
	"GET /api/admin/v1/forward-tasks/{id}/targets status": {"pending", "success", "failed", "skipped", "cancelled"},
	"GET /api/admin/v1/sms/logs status":                   {"sent", "success", "failed", "pending"},
	"GET /api/admin/v1/moderation/profiles status":        {"pending", "rejected", "restored"},
}

// enumDescs 各 query 参数枚举值的含义说明（与 queryParamEnums 值一一对应）
var enumDescs = map[string][]string{
	"GET /api/admin/v1/users status":                      {"正常", "已封禁", "已注销"},
	"GET /api/admin/v1/groups status":                     {"正常", "已封禁", "已解散", "全员禁言"},
	"GET /api/admin/v1/reports status":                    {"待处理", "处理中", "已结案", "已驳回", "已重开"},
	"GET /api/admin/v1/reports targetType":                {"用户", "群组", "消息"},
	"GET /api/admin/v1/audit-logs result":                 {"成功", "权限拒绝", "失败"},
	"GET /api/admin/v1/forward-tasks status":              {"待处理", "处理中", "已完成", "失败", "已终止"},
	"GET /api/admin/v1/forward-tasks/{id}/targets status": {"待发送", "已送达", "失败", "已跳过", "已取消"},
	"GET /api/admin/v1/sms/logs status":                   {"已发送", "已送达", "失败", "发送中"},
	"GET /api/admin/v1/moderation/profiles status":        {"待审核", "已驳回", "已恢复"},
}

// fieldEnums 请求体字段的可选值枚举（key = "接口key 字段名"）
var fieldEnums = map[string][]string{
	"PUT /api/admin/v1/admins/{id}/status status":                   {"active", "disabled"},
	"PUT /api/admin/v1/report-reasons/{id}/status status":           {"active", "disabled"},
	"PUT /api/admin/v1/sensitive-words/{id}/status status":          {"active", "disabled"},
	"PUT /api/admin/v1/app-versions/{id}/status status":             {"published", "draft"},
	"POST /api/admin/v1/app-versions platform":                      {"android", "ios"},
	"POST /api/admin/v1/report-reasons targetType":                  {"user", "group", "message"},
	"POST /api/admin/v1/moderation/profiles/{userId}/approve field": {"avatar", "nickname"},
	"POST /api/admin/v1/moderation/profiles/{userId}/reject field":  {"avatar", "nickname"},
	"POST /api/admin/v1/moderation/profiles/{userId}/restore field": {"avatar", "nickname"},
	"POST /api/admin/v1/users/{id}/reset-profile field":             {"avatar", "nickname"},
	"POST /api/admin/v1/legal-documents type":                       {"user_agreement", "privacy_policy"},
	// ---- 响应模型字段枚举 ----
	"AppUser status":            {"active", "banned", "cancelled"},
	"AppUserDetail status":      {"active", "banned", "cancelled"},
	"AdminAccount status":       {"active", "disabled"},
	"AdminRole status":          {"active", "disabled"},
	"AppGroup status":           {"normal", "banned", "dismissed", "muted"},
	"AppGroupDetail status":     {"normal", "banned", "dismissed", "muted"},
	"AppGroupMember role":       {"member", "owner"},
	"AppVersion status":         {"draft", "published"},
	"LegalDocument type":        {"user_agreement", "privacy_policy"},
	"LegalDocument status":      {"draft", "published"},
	"ReportReason targetType":   {"user", "group", "message"},
	"ReportReason status":       {"active", "disabled"},
	"Report targetType":         {"user", "group", "message"},
	"Report status":             {"pending", "processing", "resolved", "rejected", "reopened"},
	"ReportDetail targetType":   {"user", "group", "message"},
	"ReportDetail status":       {"pending", "processing", "resolved", "rejected", "reopened"},
	"ForwardTask status":        {"pending", "processing", "success", "failed", "cancelled"},
	"ForwardTarget status":      {"pending", "success", "failed", "skipped", "cancelled"},
	"RecallLog operatorType":    {"admin", "user"},
	"SensitiveWord status":      {"active", "disabled"},
	"ModerationHit disposition": {"intercept", "pending_review"},
	"ProfileModeration field":   {"avatar", "nickname"},
	"ProfileModeration status":  {"pending", "approved", "rejected"},
	"SmsLog status":             {"sent", "success", "failed", "pending"},
	"AuditLog result":           {"success", "denied", "failed"},
	"ExportJob status":          {"pending", "processing", "ready", "failed", "expired"},
	"DashboardTodo type":        {"report", "forward_risk", "sms_failed", "system_alert"},
}

// fieldEnumDescs 请求体字段枚举值的含义说明（与 fieldEnums 值一一对应）
var fieldEnumDescs = map[string][]string{
	"PUT /api/admin/v1/admins/{id}/status status":                   {"启用", "停用"},
	"PUT /api/admin/v1/report-reasons/{id}/status status":           {"启用", "停用"},
	"PUT /api/admin/v1/sensitive-words/{id}/status status":          {"启用", "停用"},
	"PUT /api/admin/v1/app-versions/{id}/status status":             {"已发布", "草稿"},
	"POST /api/admin/v1/app-versions platform":                      {"安卓", "苹果"},
	"POST /api/admin/v1/report-reasons targetType":                  {"用户", "群组", "消息"},
	"POST /api/admin/v1/moderation/profiles/{userId}/approve field": {"头像", "昵称"},
	"POST /api/admin/v1/moderation/profiles/{userId}/reject field":  {"头像", "昵称"},
	"POST /api/admin/v1/moderation/profiles/{userId}/restore field": {"头像", "昵称"},
	"POST /api/admin/v1/users/{id}/reset-profile field":             {"头像", "昵称"},
	"POST /api/admin/v1/legal-documents type":                       {"用户服务协议", "隐私政策"},
	// ---- 响应模型字段枚举说明 ----
	"AppUser status":            {"正常", "已封禁", "已注销"},
	"AppUserDetail status":      {"正常", "已封禁", "已注销"},
	"AdminAccount status":       {"启用", "停用"},
	"AdminRole status":          {"启用", "停用"},
	"AppGroup status":           {"正常", "已封禁", "已解散", "全员禁言"},
	"AppGroupDetail status":     {"正常", "已封禁", "已解散", "全员禁言"},
	"AppGroupMember role":       {"成员", "群主"},
	"AppVersion status":         {"草稿", "已发布"},
	"LegalDocument type":        {"用户服务协议", "隐私政策"},
	"LegalDocument status":      {"草稿", "已发布"},
	"ReportReason targetType":   {"用户", "群组", "消息"},
	"ReportReason status":       {"启用", "停用"},
	"Report targetType":         {"用户", "群组", "消息"},
	"Report status":             {"待处理", "处理中", "已结案", "已驳回", "已重开"},
	"ReportDetail targetType":   {"用户", "群组", "消息"},
	"ReportDetail status":       {"待处理", "处理中", "已结案", "已驳回", "已重开"},
	"ForwardTask status":        {"待处理", "处理中", "已完成", "失败", "已终止"},
	"ForwardTarget status":      {"待发送", "已送达", "失败", "已跳过", "已取消"},
	"RecallLog operatorType":    {"管理员", "用户"},
	"SensitiveWord status":      {"启用", "停用"},
	"ModerationHit disposition": {"已拦截", "待复核"},
	"ProfileModeration field":   {"头像", "昵称"},
	"ProfileModeration status":  {"待审核", "已同意", "已驳回"},
	"SmsLog status":             {"已发送", "已送达", "失败", "发送中"},
	"AuditLog result":           {"成功", "权限拒绝", "失败"},
	"ExportJob status":          {"待处理", "处理中", "已完成", "失败", "已过期"},
	"DashboardTodo type":        {"举报", "转发风险", "短信失败", "系统告警"},
}

func param(name, in, desc, typ string, required bool, enum []string, enumDesc []string) map[string]any {
	schema := map[string]any{"type": typ}
	if len(enum) > 0 {
		schema["enum"] = enum
		if len(enumDesc) == len(enum) {
			schema["x-enum-descriptions"] = enumDesc
			desc = appendEnumDesc(desc, enumDescriptions(enum, enumDesc))
		}
	}
	return map[string]any{
		"name":        name,
		"in":          in,
		"description": desc,
		"required":    required,
		"schema":      schema,
	}
}

// enumDescriptions 把枚举值与说明拼成 "值=说明, 值=说明"
func enumDescriptions(enum, desc []string) string {
	parts := make([]string, 0, len(enum))
	for i, v := range enum {
		if i < len(desc) && desc[i] != "" {
			parts = append(parts, v+"="+desc[i])
		} else {
			parts = append(parts, v)
		}
	}
	return strings.Join(parts, ", ")
}

// appendEnumDesc 把枚举说明追加到参数描述末尾（apifox 即使不识别 x-enum-descriptions 也能在说明中看到）
func appendEnumDesc(desc, parts string) string {
	if desc == "" {
		return "可选值：" + parts
	}
	return desc + "（可选值：" + parts + "）"
}

// requestBody 写操作请求体：优先使用业务字段映射（含必填/选填），未覆盖的用 AdminActionRequest
func requestBody(method, p string) any {
	key := strings.ToUpper(method) + " " + openapiPath(p)
	if fields, ok := writeBodyFields[key]; ok {
		return bodyFromFields(key, fields)
	}
	if method == "GET" || method == "DELETE" {
		return nil
	}
	return map[string]any{
		"required": true,
		"content":  map[string]any{"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/AdminActionRequest"}}},
	}
}

// fieldSpec 请求体字段定义
type fieldSpec struct {
	Name     string
	Type     string // string|integer|boolean|array|object
	Required bool
	Desc     string
}

// nestedBodyFields 请求体中 object 字段的子结构（key = "方法 路径 字段名"）
var nestedBodyFields = map[string][]fieldSpec{
	"PUT /api/admin/v1/system-limits limits": {
		{"maxFileSizeMb", "integer", false, "单文件大小上限(MB)"},
		{"maxGroupMembers", "integer", false, "单群成员数上限"},
		{"recallWindowSec", "integer", false, "消息撤回时间窗(秒)"},
		{"maxForwardTargets", "integer", false, "单次转发目标数上限"},
		{"maxNicknameLen", "integer", false, "昵称最大长度"},
	},
	"PUT /api/admin/v1/forward-settings settings": {
		{"globalQps", "integer", false, "全局每秒发送速度"},
		{"workerConcurrency", "integer", false, "Worker 并发"},
		{"claimBatchSize", "integer", false, "单次领取数量"},
		{"perUserConcurrency", "integer", false, "单用户并发"},
		{"retryBaseSeconds", "integer", false, "初始重试间隔"},
		{"retryMaxSeconds", "integer", false, "最大重试间隔"},
		{"processingLockSeconds", "integer", false, "处理锁超时"},
		{"queuePaused", "boolean", false, "暂停消费但继续受理"},
		{"retentionDays", "integer", false, "明细保留天数"},
		{"queueAlertDepth", "integer", false, "积压告警阈值"},
	},
}

// arrayBodyItems 请求体中 array 字段的元素类型（key = "方法 路径 字段名"）
var arrayBodyItems = map[string]string{
	"POST /api/admin/v1/sensitive-words/import words":        "string",
	"POST /api/admin/v1/reports/{id}/reject disposeActions":  "string",
	"POST /api/admin/v1/reports/{id}/reopen disposeActions":  "string",
	"POST /api/admin/v1/reports/{id}/resolve disposeActions": "string",
	"POST /api/admin/v1/admins roleIds":                      "string",
	"PATCH /api/admin/v1/admins/{id} roleIds":                "string",
	"POST /api/admin/v1/roles permissions":                   "string",
	"PUT /api/admin/v1/roles/{id} permissions":               "string",
	// 模型响应 array 字段（key = "模型名 字段名"；值 "ref:模型名" 表示引用模型）
	"AdminAccount roleNames": "string",
	"AdminAccount roleIds":   "string",
	"AdminRole permissions":  "string",
	"MeResult permissions":   "string",
	"AppUserDetail groupIds": "string",
	"ReportDetail files":     "ref:ReportFile",
	"ReportDetail notes":     "ref:ReportNote",
	"SmsStatistics byDate":   "ref:SmsStatPoint",
}

func bodyFromFields(key string, fields []fieldSpec) any {
	schema := objectSchema(key, fields)
	return map[string]any{
		"required": true,
		"content":  map[string]any{"application/json": map[string]any{"schema": schema}},
	}
}

// objectSchema 根据字段定义生成 object schema（支持 array/object 嵌套）
func objectSchema(prefix string, fields []fieldSpec) map[string]any {
	props := map[string]any{}
	required := []string{}
	for _, f := range fields {
		props[f.Name] = propSchema(prefix, f)
		if f.Required {
			required = append(required, f.Name)
		}
	}
	schema := map[string]any{"type": "object", "properties": props}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

// propSchema 单个请求字段的 schema（prefix 用于定位嵌套结构表）
func propSchema(prefix string, f fieldSpec) map[string]any {
	p := map[string]any{"type": f.Type}
	if f.Desc != "" {
		p["description"] = f.Desc
	}
	if enums, ok := fieldEnums[prefix+" "+f.Name]; ok {
		p["enum"] = enums
		if descs, ok2 := fieldEnumDescs[prefix+" "+f.Name]; ok2 && len(descs) == len(enums) {
			p["x-enum-descriptions"] = descs
			cur, _ := p["description"].(string)
			if cur == "" {
				p["description"] = "可选值：" + enumDescriptions(enums, descs)
			} else {
				p["description"] = cur + "（可选值：" + enumDescriptions(enums, descs) + "）"
			}
		}
	}
	switch f.Type {
	case "array":
		if spec, ok := arrayBodyItems[prefix+" "+f.Name]; ok {
			if strings.HasPrefix(spec, "ref:") {
				p["items"] = map[string]any{"$ref": "#/components/schemas/" + strings.TrimPrefix(spec, "ref:")}
			} else {
				p["items"] = map[string]any{"type": spec}
			}
		}
	case "object":
		if nested, ok := nestedBodyFields[prefix+" "+f.Name]; ok {
			return objectSchema(prefix+" "+f.Name, nested)
		}
	}
	return p
}

// writeBodyFields 各写操作请求体字段（key = 方法 + OpenAPI 路径）
var writeBodyFields = map[string][]fieldSpec{
	"POST /api/admin/v1/auth/login": {
		{"username", "string", true, "管理员账号"},
		{"password", "string", true, "登录密码"},
	},
	"POST /api/admin/v1/auth/mfa/verify": {
		{"challengeToken", "string", true, "上一步 login 返回的 mfaChallenge"},
		{"code", "string", true, "6位 TOTP 验证码"},
	},
	"POST /api/admin/v1/auth/token/refresh": {
		{"refreshToken", "string", true, "登录/刷新时返回的 refreshToken"},
	},
	"POST /api/admin/v1/auth/logout": {
		{"refreshToken", "string", true, "要注销会话的 refreshToken"},
	},
	"PUT /api/admin/v1/me/password": {
		{"oldPassword", "string", true, "原密码"},
		{"newPassword", "string", true, "新密码（至少6位）"},
	},
	"POST /api/admin/v1/me/mfa/setup": {
		{"code", "string", true, "6位验证码"},
	},
	"POST /api/admin/v1/me/mfa/disable": {
		{"code", "string", true, "6位验证码"},
	},
	"POST /api/admin/v1/admins": {
		{"username", "string", true, "登录账号"},
		{"password", "string", true, "初始密码（至少6位）"},
		{"nickname", "string", false, "昵称"},
		{"roleIds", "array", false, "角色 ID 列表"},
		{"status", "string", false, "active|disabled"},
	},
	"PATCH /api/admin/v1/admins/{id}": {
		{"password", "string", false, "新密码（至少6位，不填不改）"},
		{"nickname", "string", false, "昵称"},
		{"roleIds", "array", false, "角色 ID 列表"},
		{"status", "string", false, "active|disabled"},
	},
	"PUT /api/admin/v1/admins/{id}/status": {
		{"status", "string", true, "active|disabled"},
		{"reason", "string", false, "操作原因"},
	},
	"POST /api/admin/v1/admins/{id}/mfa/reset": {
		{"reason", "string", false, "操作原因"},
	},
	"POST /api/admin/v1/roles": {
		{"name", "string", true, "角色名称"},
		{"code", "string", true, "角色编码（如 operator）"},
		{"description", "string", false, "描述"},
		{"permissions", "array", false, "权限码列表（见 /permissions）"},
	},
	"PUT /api/admin/v1/roles/{id}": {
		{"name", "string", false, "角色名称"},
		{"description", "string", false, "描述"},
		{"status", "string", false, "active|disabled"},
		{"permissions", "array", false, "权限码列表"},
	},
	"DELETE /api/admin/v1/roles/{id}": {
		{"reason", "string", false, "操作原因（可选，用于审计）"},
	},
	"POST /api/admin/v1/users/{id}/phone/reveal": {
		{"reason", "string", true, "查看原因"},
		{"ticketNo", "string", false, "关联工单号"},
	},
	"PUT /api/admin/v1/users/{id}/login-restriction": {
		{"banned", "boolean", true, "是否禁止登录"},
		{"until", "string", false, "截止时间 ISO8601，永久留空"},
		{"reason", "string", true, "操作原因"},
	},
	"PUT /api/admin/v1/users/{id}/message-restriction": {
		{"banned", "boolean", true, "是否禁止发消息"},
		{"until", "string", false, "截止时间 ISO8601"},
		{"reason", "string", true, "操作原因"},
	},
	"PUT /api/admin/v1/users/{id}/ban": {
		{"banned", "boolean", true, "是否封禁"},
		{"until", "string", false, "截止时间 ISO8601，永久留空"},
		{"reason", "string", true, "操作原因"},
		{"ticketNo", "string", false, "关联工单号"},
		{"idempotencyKey", "string", false, "幂等键"},
	},
	"POST /api/admin/v1/users/{id}/sessions/revoke": {
		{"reason", "string", true, "操作原因"},
		{"ticketNo", "string", false, "关联工单号"},
		{"idempotencyKey", "string", false, "幂等键"},
	},
	"POST /api/admin/v1/users/{id}/reset-profile": {
		{"field", "string", true, "avatar|nickname"},
		{"reason", "string", true, "操作原因"},
	},
	"POST /api/admin/v1/users/{id}/cancel": {
		{"reason", "string", true, "注销原因"},
	},
	"PUT /api/admin/v1/groups/{id}/mute-all": {
		{"muted", "boolean", true, "是否全员禁言"},
		{"reason", "string", true, "操作原因"},
	},
	"PUT /api/admin/v1/groups/{id}/member-add-friend": {
		{"enabled", "boolean", true, "是否允许群内互加好友"},
		{"reason", "string", true, "操作原因"},
	},
	"POST /api/admin/v1/groups/{id}/dissolve": {
		{"reason", "string", true, "解散原因"},
		{"ticketNo", "string", false, "关联工单号"},
		{"idempotencyKey", "string", false, "幂等键"},
	},
	"POST /api/admin/v1/groups/{id}/messages/{messageId}/recall": {
		{"reason", "string", true, "撤回原因"},
		{"ticketNo", "string", false, "关联工单号"},
		{"idempotencyKey", "string", false, "幂等键"},
	},
	"POST /api/admin/v1/reports/{id}/assign": {
		{"assigneeId", "string", true, "接单管理员 ID"},
		{"reason", "string", true, "操作原因"},
	},
	"POST /api/admin/v1/reports/{id}/notes": {
		{"content", "string", true, "备注内容"},
	},
	"POST /api/admin/v1/reports/{id}/resolve": {
		{"conclusion", "string", false, "结案结论"},
		{"disposeActions", "array", false, "处置动作：warn|restrict_login|restrict_message|ban|mute_all|recall|dissolve"},
		{"reason", "string", true, "操作原因"},
		{"ticketNo", "string", false, "关联工单号"},
		{"idempotencyKey", "string", false, "幂等键"},
	},
	"POST /api/admin/v1/reports/{id}/reject": {
		{"conclusion", "string", false, "结案结论"},
		{"disposeActions", "array", false, "处置动作：warn|restrict_login|restrict_message|ban|mute_all|recall|dissolve"},
		{"reason", "string", true, "驳回原因"},
		{"ticketNo", "string", false, "关联工单号"},
		{"idempotencyKey", "string", false, "幂等键"},
	},
	"POST /api/admin/v1/reports/{id}/reopen": {
		{"conclusion", "string", false, "结案结论"},
		{"disposeActions", "array", false, "处置动作：warn|restrict_login|restrict_message|ban|mute_all|recall|dissolve"},
		{"reason", "string", true, "重开原因"},
		{"ticketNo", "string", false, "关联工单号"},
		{"idempotencyKey", "string", false, "幂等键"},
	},
	"POST /api/admin/v1/forward-tasks/{id}/cancel": {
		{"reason", "string", true, "终止原因"},
	},
	"POST /api/admin/v1/forward-tasks/{id}/retry-failed": {
		{"reason", "string", true, "操作原因"},
	},
	"PUT /api/admin/v1/forward-limits/users/{userId}": {
		{"dailyLimit", "integer", false, "历史每日值，不参与拦截"},
		{"hourlyLimit", "integer", false, "历史每小时值，不参与拦截"},
		{"singleTargets", "integer", false, "历史单次值，不参与拦截"},
		{"enabled", "boolean", false, "历史开关，不参与拦截"},
		{"reason", "string", true, "操作原因"},
	},
	"PUT /api/admin/v1/forward-settings": {
		{"settings", "object", true, "全局转发规则对象"},
		{"reason", "string", true, "操作原因"},
	},
	"POST /api/admin/v1/countries": {
		{"code", "string", true, "国家码（如 CN）"},
		{"dialCode", "string", false, "区号（如 86）"},
		{"cnName", "string", false, "中文名"},
		{"enName", "string", false, "英文名"},
		{"phoneRule", "string", false, "号码规则"},
		{"enabled", "boolean", false, "是否启用"},
		{"sortOrder", "integer", false, "排序"},
	},
	"PUT /api/admin/v1/countries/{code}/status": {
		{"enabled", "boolean", true, "是否启用注册"},
		{"reason", "string", true, "操作原因"},
	},
	"POST /api/admin/v1/app-versions": {
		{"platform", "string", false, "android|ios"},
		{"version", "string", true, "版本号"},
		{"description", "string", false, "更新说明"},
		{"downloadUrl", "string", false, "下载地址"},
		{"forceUpgrade", "boolean", false, "是否强制升级"},
	},
	"PUT /api/admin/v1/app-versions/{id}": {
		{"description", "string", false, "更新说明"},
		{"downloadUrl", "string", false, "下载地址"},
		{"forceUpgrade", "boolean", false, "是否强制升级"},
	},
	"PUT /api/admin/v1/app-versions/{id}/status": {
		{"status", "string", true, "published|draft"},
		{"reason", "string", true, "操作原因"},
	},
	"POST /api/admin/v1/legal-documents": {
		{"type", "string", true, "user_agreement|privacy_policy"},
		{"version", "string", true, "版本号"},
		{"language", "string", false, "语言（默认 zh）"},
		{"title", "string", true, "标题"},
		{"contentUrl", "string", true, "内容 URL"},
		{"reason", "string", true, "操作原因"},
	},
	"POST /api/admin/v1/report-reasons": {
		{"targetType", "string", false, "user|group|message"},
		{"reason", "string", true, "原因文案"},
		{"language", "string", false, "语言"},
		{"sortOrder", "integer", false, "排序"},
		{"status", "string", false, "active|disabled"},
	},
	"PUT /api/admin/v1/report-reasons/{id}": {
		{"targetType", "string", false, "user|group|message"},
		{"reason", "string", false, "原因文案"},
		{"language", "string", false, "语言"},
		{"sortOrder", "integer", false, "排序"},
	},
	"PUT /api/admin/v1/report-reasons/{id}/status": {
		{"status", "string", true, "active|disabled"},
	},
	"PUT /api/admin/v1/system-limits": {
		{"limits", "object", true, "系统限制对象"},
		{"reason", "string", true, "操作原因"},
	},
	"PUT /api/admin/v1/features": {
		{"mfa", "boolean", false, "MFA 多因素认证开关（不传则保持原值）"},
		{"report", "boolean", false, "举报功能开关（不传则保持原值）"},
		{"reason", "string", true, "操作原因"},
	},
	"POST /api/admin/v1/system-limits/publish": {
		{"reason", "string", true, "操作原因"},
	},
	"POST /api/admin/v1/sensitive-words": {
		{"word", "string", true, "敏感词"},
		{"category", "string", false, "分类"},
	},
	"POST /api/admin/v1/sensitive-words/import": {
		{"words", "array", true, "敏感词列表"},
		{"category", "string", false, "分类"},
		{"reason", "string", true, "操作原因"},
	},
	"PUT /api/admin/v1/sensitive-words/{id}": {
		{"word", "string", false, "敏感词"},
		{"category", "string", false, "分类"},
		{"status", "string", false, "active|disabled"},
	},
	"PUT /api/admin/v1/sensitive-words/{id}/status": {
		{"status", "string", true, "active|disabled"},
	},
	"POST /api/admin/v1/moderation/profiles/{userId}/approve": {
		{"field", "string", true, "avatar|nickname"},
		{"reason", "string", true, "操作原因"},
	},
	"POST /api/admin/v1/moderation/profiles/{userId}/reject": {
		{"field", "string", true, "avatar|nickname"},
		{"reason", "string", true, "驳回原因"},
	},
	"POST /api/admin/v1/moderation/profiles/{userId}/restore": {
		{"field", "string", true, "avatar|nickname"},
		{"reason", "string", true, "操作原因"},
	},
	"POST /api/admin/v1/exports": {
		{"resource", "string", true, "导出资源（users/groups/reports 等）"},
		{"filters", "string", false, "过滤条件 JSON"},
	},
}

// tagFor 按路径分组到清单模块
func tagFor(p string) string {
	switch {
	case strings.Contains(p, "/health"), strings.Contains(p, "/meta"):
		return "系统"
	case strings.Contains(p, "/auth/"), strings.Contains(p, "/me"):
		return "认证与我的"
	case strings.Contains(p, "/admins"), strings.Contains(p, "/roles"), strings.Contains(p, "/permissions"):
		return "管理员与角色"
	case strings.Contains(p, "/users"):
		return "用户管理"
	case strings.Contains(p, "/groups"):
		return "群组管理"
	case strings.Contains(p, "/reports"):
		return "举报处置"
	case strings.Contains(p, "/forward"):
		return "转发风控"
	case strings.Contains(p, "/countries"), strings.Contains(p, "/sms"):
		return "国家短信"
	case strings.Contains(p, "/app-versions"), strings.Contains(p, "/legal-documents"),
		strings.Contains(p, "/report-reasons"), strings.Contains(p, "/system-limits"):
		return "APP配置"
	case strings.Contains(p, "/sensitive-words"), strings.Contains(p, "/moderation"):
		return "敏感词审核"
	case strings.Contains(p, "/audit-logs"), strings.Contains(p, "/admin-login-logs"):
		return "审计日志"
	case strings.Contains(p, "/system/errors"), strings.Contains(p, "/exports"):
		return "运行观测"
	case strings.Contains(p, "/dashboard"):
		return "工作台"
	}
	return "其他"
}

func opID(method, p string) string {
	return strings.ToUpper(method) + strings.ReplaceAll(openapiPath(p), "/", "_")
}

func buildTags() []map[string]any {
	names := []string{"系统", "认证与我的", "管理员与角色", "用户管理", "群组管理", "举报处置", "转发风控", "国家短信", "APP配置", "敏感词审核", "审计日志", "运行观测", "工作台"}
	out := make([]map[string]any, 0, len(names))
	for _, n := range names {
		out = append(out, map[string]any{"name": n})
	}
	return out
}

// apiDescriptions 接口中文描述（key = 方法 + OpenAPI 路径）
var apiDescriptions = map[string]string{
	"GET /api/admin/v1/health":                                   "后台存活检查",
	"GET /api/admin/v1/meta":                                     "后台版本、commit、构建时间与功能开关",
	"POST /api/admin/v1/auth/login":                              "管理员密码登录（启用 MFA 时返回挑战凭证）",
	"POST /api/admin/v1/auth/mfa/verify":                         "MFA 二次验证，验证通过后签发正式 token",
	"POST /api/admin/v1/auth/token/refresh":                      "用 refresh token 刷新 access token（自动轮换）",
	"POST /api/admin/v1/auth/logout":                             "退出当前后台会话",
	"POST /api/admin/v1/auth/logout-all":                         "退出当前管理员全部后台会话",
	"GET /api/admin/v1/me":                                       "获取当前管理员资料与权限列表",
	"PUT /api/admin/v1/me/password":                              "修改本人登录密码",
	"GET /api/admin/v1/me/mfa":                                   "查看本人 MFA 状态（未启用时返回绑定密钥）",
	"POST /api/admin/v1/me/mfa/setup":                            "验证 TOTP 码后启用 MFA",
	"POST /api/admin/v1/me/mfa/disable":                          "验证 TOTP 码后关闭 MFA",
	"GET /api/admin/v1/admins":                                   "管理员列表（按关键字/分页）",
	"POST /api/admin/v1/admins":                                  "创建管理员（密码至少6位，可分配角色）",
	"PATCH /api/admin/v1/admins/{id}":                            "修改管理员（昵称/密码/角色/状态）",
	"PUT /api/admin/v1/admins/{id}/status":                       "启用/停用管理员（停用时其全部会话立即失效）",
	"POST /api/admin/v1/admins/{id}/mfa/reset":                   "重置指定管理员的 MFA",
	"GET /api/admin/v1/roles":                                    "角色列表（含权限码）",
	"POST /api/admin/v1/roles":                                   "创建角色并分配权限",
	"PUT /api/admin/v1/roles/{id}":                               "修改角色信息与权限",
	"DELETE /api/admin/v1/roles/{id}":                            "删除角色（内置 super_admin 不可删除）",
	"GET /api/admin/v1/permissions":                              "权限码字典列表",
	"GET /api/admin/v1/audit-logs":                               "管理操作审计日志（按关键字/结果/资源筛选）",
	"GET /api/admin/v1/audit-logs/{id}":                          "审计日志详情",
	"GET /api/admin/v1/admin-login-logs":                         "管理员登录日志",
	"GET /api/admin/v1/dashboard/overview":                       "工作台核心概览（用户/活跃/群/消息/转发/短信/待办举报）",
	"GET /api/admin/v1/dashboard/trends":                         "按日趋势统计（注册/活跃/消息/举报/转发）",
	"GET /api/admin/v1/dashboard/todos":                          "工作台待办列表（待处理举报/转发风险/系统告警）",
	"GET /api/admin/v1/users":                                    "用户列表（按关键字/状态筛选，手机号已脱敏）",
	"GET /api/admin/v1/users/{id}":                               "用户详情（资料/好友/群/限制/举报统计）",
	"POST /api/admin/v1/users/{id}/phone/reveal":                 "查看完整手机号（需权限+原因+工单号，动作审计）",
	"GET /api/admin/v1/users/{id}/groups":                        "用户加入的群列表",
	"GET /api/admin/v1/users/{id}/reports":                       "用户被举报记录",
	"GET /api/admin/v1/users/{id}/forward-tasks":                 "用户的转发任务记录",
	"PUT /api/admin/v1/users/{id}/login-restriction":             "设置/解除用户登录限制",
	"PUT /api/admin/v1/users/{id}/message-restriction":           "设置/解除用户发消息限制",
	"PUT /api/admin/v1/users/{id}/ban":                           "封禁/解封用户（封禁撤销其全部登录会话）",
	"POST /api/admin/v1/users/{id}/sessions/revoke":              "强制用户全部设备下线",
	"POST /api/admin/v1/users/{id}/reset-profile":                "重置用户头像/昵称（需原因，写回 server 并同步 OpenIM）",
	"POST /api/admin/v1/users/{id}/cancel":                       "注销用户（状态置为已注销并撤销全部会话）",
	"GET /api/admin/v1/users/phone-search":                       "按手机号搜索用户（需 users.phone.search 权限）",
	"GET /api/admin/v1/groups":                                   "群列表（按关键字/状态筛选）",
	"GET /api/admin/v1/groups/{id}":                              "群详情（设置/公告/全员禁言等）",
	"GET /api/admin/v1/groups/{id}/members":                      "群成员列表",
	"GET /api/admin/v1/groups/{id}/reports":                      "群被举报记录",
	"PUT /api/admin/v1/groups/{id}/mute-all":                     "设置/解除群全员禁言",
	"PUT /api/admin/v1/groups/{id}/member-add-friend":            "设置群内成员互加好友开关",
	"POST /api/admin/v1/groups/{id}/dissolve":                    "解散违规群（高风险，需原因）",
	"GET /api/admin/v1/groups/{id}/recall-logs":                  "群内管理撤回记录",
	"POST /api/admin/v1/groups/{id}/messages/{messageId}/recall": "管理撤回指定消息（需关联原因/工单）",
	"GET /api/admin/v1/reports":                                  "举报列表（按状态/目标类型/关键字筛选）",
	"GET /api/admin/v1/reports/{id}":                             "举报详情（含证据/备注）",
	"POST /api/admin/v1/reports/{id}/assign":                     "指派/领取举报工单",
	"POST /api/admin/v1/reports/{id}/start":                      "标记举报为处理中",
	"POST /api/admin/v1/reports/{id}/notes":                      "补充举报内部备注",
	"POST /api/admin/v1/reports/{id}/resolve":                    "举报成立并结案（记录结论与处置动作）",
	"POST /api/admin/v1/reports/{id}/reject":                     "举报驳回并结案",
	"POST /api/admin/v1/reports/{id}/reopen":                     "重新打开已结案工单",
	"GET /api/admin/v1/reports/{id}/actions":                     "举报处置历史记录",
	"GET /api/admin/v1/forward-tasks":                            "转发任务列表（成功/失败/跳过统计）",
	"GET /api/admin/v1/forward-tasks/{id}":                       "转发任务详情",
	"GET /api/admin/v1/forward-tasks/{id}/targets":               "转发任务目标明细分页",
	"GET /api/admin/v1/forward-tasks/{id}/failures":              "转发失败原因统计",
	"POST /api/admin/v1/forward-tasks/{id}/cancel":               "终止待处理转发任务（已成功消息不撤回）",
	"POST /api/admin/v1/forward-tasks/{id}/retry-failed":         "重试失败转发目标",
	"GET /api/admin/v1/forward-limits/users/{userId}":            "查看历史用户转发限额审计（不参与发送拦截）",
	"PUT /api/admin/v1/forward-limits/users/{userId}":            "写入历史用户转发限额审计（不参与发送拦截）",
	"GET /api/admin/v1/forward-settings":                         "获取转发调度与可靠性配置（不限总量）",
	"PUT /api/admin/v1/forward-settings":                         "修改转发调度与可靠性配置（只影响速度）",
	"GET /api/admin/v1/forward-queue-metrics":                    "获取可靠队列指标",
	"GET /api/admin/v1/countries":                                "国家/地区列表",
	"POST /api/admin/v1/countries":                               "新增国家/地区",
	"PUT /api/admin/v1/countries/{code}/status":                  "启用/停用国家注册",
	"GET /api/admin/v1/sms/logs":                                 "短信发送日志（手机号脱敏）",
	"GET /api/admin/v1/sms/logs/{id}":                            "短信日志详情",
	"GET /api/admin/v1/sms/statistics":                           "短信送达统计（按日）",
	"GET /api/admin/v1/sms/providers/health":                     "短信供应商健康状态",
	"GET /api/admin/v1/app-versions":                             "APP 版本列表",
	"POST /api/admin/v1/app-versions":                            "创建 APP 版本",
	"PUT /api/admin/v1/app-versions/{id}":                        "修改 APP 版本",
	"PUT /api/admin/v1/app-versions/{id}/status":                 "发布/下线 APP 版本",
	"GET /api/admin/v1/legal-documents":                          "协议文档列表（用户协议/隐私政策）",
	"POST /api/admin/v1/legal-documents":                         "创建协议版本",
	"POST /api/admin/v1/legal-documents/{id}/publish":            "发布协议版本",
	"GET /api/admin/v1/report-reasons":                           "举报原因列表",
	"POST /api/admin/v1/report-reasons":                          "新建举报原因",
	"PUT /api/admin/v1/report-reasons/{id}":                      "修改举报原因",
	"PUT /api/admin/v1/report-reasons/{id}/status":               "启用/停用举报原因（被引用只能停用）",
	"GET /api/admin/v1/system-limits":                            "获取系统限制配置（已发布）",
	"PUT /api/admin/v1/system-limits":                            "保存系统限制草稿",
	"POST /api/admin/v1/system-limits/publish":                   "发布系统限制配置（版本化）",
	"GET /api/admin/v1/features":                                 "获取功能开关（MFA/举报）",
	"PUT /api/admin/v1/features":                                 "设置功能开关（MFA/举报，可部分修改）",
	"GET /api/admin/v1/sensitive-words":                          "敏感词列表",
	"POST /api/admin/v1/sensitive-words":                         "新建敏感词",
	"POST /api/admin/v1/sensitive-words/import":                  "批量导入敏感词",
	"PUT /api/admin/v1/sensitive-words/{id}":                     "修改敏感词",
	"PUT /api/admin/v1/sensitive-words/{id}/status":              "启用/停用敏感词",
	"GET /api/admin/v1/moderation/hits":                          "敏感词命中记录",
	"GET /api/admin/v1/moderation/profiles":                      "待审核头像/昵称列表",
	"POST /api/admin/v1/moderation/profiles/{userId}/approve":    "同意头像/昵称资料审核（状态→已同意）",
	"POST /api/admin/v1/moderation/profiles/{userId}/reject":     "驳回头像/昵称（状态→已驳回）",
	"POST /api/admin/v1/moderation/profiles/{userId}/restore":    "恢复到待审核队列（状态→待审核）",
	"GET /api/admin/v1/system/errors":                            "运行错误列表",
	"GET /api/admin/v1/system/errors/{id}":                       "运行错误详情",
	"POST /api/admin/v1/exports":                                 "创建异步导出任务",
	"GET /api/admin/v1/exports":                                  "查询/下载导出任务列表",
}

// ===== 响应结构建模 =====

// dataKind 描述接口响应的 data 结构
type dataKind struct {
	Kind  string      // page|array|ref|props
	Model string      // page/array/ref 对应的模型名
	Props []fieldSpec // props 时内联字段
}

// responseData 各接口响应 data 结构（key = 方法 + OpenAPI 路径）
// 未声明的 GET 视为无结构；未声明的写操作默认 {ok}
var responseData = map[string]dataKind{
	// ---- 分页 {items,total,page,pageSize} ----
	"GET /api/admin/v1/users":                      {Kind: "page", Model: "AppUser"},
	"GET /api/admin/v1/users/phone-search":         {Kind: "page", Model: "AppUser"},
	"GET /api/admin/v1/admins":                     {Kind: "page", Model: "AdminAccount"},
	"GET /api/admin/v1/groups":                     {Kind: "page", Model: "AppGroup"},
	"GET /api/admin/v1/reports":                    {Kind: "page", Model: "Report"},
	"GET /api/admin/v1/audit-logs":                 {Kind: "page", Model: "AuditLog"},
	"GET /api/admin/v1/admin-login-logs":           {Kind: "page", Model: "LoginLog"},
	"GET /api/admin/v1/forward-tasks":              {Kind: "page", Model: "ForwardTask"},
	"GET /api/admin/v1/forward-tasks/{id}/targets": {Kind: "page", Model: "ForwardTarget"},
	"GET /api/admin/v1/sms/logs":                   {Kind: "page", Model: "SmsLog"},
	"GET /api/admin/v1/users/{id}/reports":         {Kind: "page", Model: "Report"},
	"GET /api/admin/v1/users/{id}/forward-tasks":   {Kind: "page", Model: "ForwardTask"},
	"GET /api/admin/v1/groups/{id}/reports":        {Kind: "page", Model: "Report"},
	"GET /api/admin/v1/groups/{id}/recall-logs":    {Kind: "page", Model: "RecallLog"},
	"GET /api/admin/v1/system/errors":              {Kind: "page", Model: "ErrorEvent"},
	"GET /api/admin/v1/exports":                    {Kind: "page", Model: "ExportJob"},
	"GET /api/admin/v1/moderation/hits":            {Kind: "page", Model: "ModerationHit"},
	"GET /api/admin/v1/moderation/profiles":        {Kind: "page", Model: "ProfileModeration"},
	// ---- 数组（裸数组） ----
	"GET /api/admin/v1/roles":                       {Kind: "array", Model: "AdminRole"},
	"GET /api/admin/v1/permissions":                 {Kind: "array", Model: "AdminPermission"},
	"GET /api/admin/v1/users/{id}/groups":           {Kind: "array", Model: "AppGroup"},
	"GET /api/admin/v1/groups/{id}/members":         {Kind: "array", Model: "AppGroupMember"},
	"GET /api/admin/v1/forward-tasks/{id}/failures": {Kind: "array"}, // 自由对象数组
	"GET /api/admin/v1/countries":                   {Kind: "array", Model: "Country"},
	"GET /api/admin/v1/sms/providers/health":        {Kind: "array", Model: "ProviderHealth"},
	"GET /api/admin/v1/app-versions":                {Kind: "array", Model: "AppVersion"},
	"GET /api/admin/v1/legal-documents":             {Kind: "array", Model: "LegalDocument"},
	"GET /api/admin/v1/report-reasons":              {Kind: "array", Model: "ReportReason"},
	"GET /api/admin/v1/sensitive-words":             {Kind: "array", Model: "SensitiveWord"},
	"GET /api/admin/v1/reports/{id}/actions":        {Kind: "array", Model: "ReportAction"},
	"GET /api/admin/v1/dashboard/trends":            {Kind: "array", Model: "DashboardTrend"},
	"GET /api/admin/v1/dashboard/todos":             {Kind: "array", Model: "DashboardTodo"},
	// ---- 详情对象 ----
	"GET /api/admin/v1/users/{id}":                    {Kind: "ref", Model: "AppUserDetail"},
	"GET /api/admin/v1/groups/{id}":                   {Kind: "ref", Model: "AppGroupDetail"},
	"GET /api/admin/v1/forward-tasks/{id}":            {Kind: "ref", Model: "ForwardTask"},
	"GET /api/admin/v1/sms/logs/{id}":                 {Kind: "ref", Model: "SmsLog"},
	"GET /api/admin/v1/reports/{id}":                  {Kind: "ref", Model: "ReportDetail"},
	"GET /api/admin/v1/system/errors/{id}":            {Kind: "ref", Model: "ErrorEvent"},
	"GET /api/admin/v1/audit-logs/{id}":               {Kind: "ref", Model: "AuditLog"},
	"GET /api/admin/v1/forward-limits/users/{userId}": {Kind: "ref", Model: "ForwardUserLimit"},
	"GET /api/admin/v1/forward-settings":              {Kind: "ref", Model: "ForwardSettings"},
	"GET /api/admin/v1/forward-queue-metrics":         {Kind: "ref", Model: "ForwardQueueMetrics"},
	"GET /api/admin/v1/system-limits":                 {Kind: "ref", Model: "SystemLimits"},
	"GET /api/admin/v1/dashboard/overview":            {Kind: "ref", Model: "DashboardOverview"},
	"GET /api/admin/v1/sms/statistics":                {Kind: "ref", Model: "SmsStatistics"},
	"GET /api/admin/v1/me":                            {Kind: "ref", Model: "MeResult"},
	// ---- 特殊内联对象 ----
	"GET /api/admin/v1/health": {Kind: "props", Props: []fieldSpec{
		{"status", "string", false, "ok"},
	}},
	"GET /api/admin/v1/meta": {Kind: "props", Props: []fieldSpec{
		{"version", "string", false, "后台版本"},
		{"commit", "string", false, "Git commit"},
		{"buildTime", "string", false, "构建时间"},
		{"features", "object", false, "功能开关"},
	}},
	"GET /api/admin/v1/me/mfa": {Kind: "props", Props: []fieldSpec{
		{"enabled", "boolean", false, "是否已启用 MFA"},
		{"secret", "string", false, "未启用时的绑定密钥（仅未启用时返回）"},
	}},
	"GET /api/admin/v1/features": {Kind: "props", Props: []fieldSpec{
		{"mfa", "boolean", false, "MFA 多因素认证是否启用"},
		{"report", "boolean", false, "举报功能是否启用"},
	}},
	// ---- 登录/刷新返回 ----
	"POST /api/admin/v1/auth/login":         {Kind: "ref", Model: "LoginResult"},
	"POST /api/admin/v1/auth/mfa/verify":    {Kind: "ref", Model: "LoginResult"},
	"POST /api/admin/v1/auth/token/refresh": {Kind: "ref", Model: "LoginResult"},
	// ---- 写操作特定返回 ----
	"POST /api/admin/v1/roles": {Kind: "props", Props: []fieldSpec{
		{"id", "string", false, "角色 ID"},
	}},
	"POST /api/admin/v1/legal-documents": {Kind: "props", Props: []fieldSpec{
		{"id", "string", false, "协议 ID"},
	}},
	"POST /api/admin/v1/exports": {Kind: "props", Props: []fieldSpec{
		{"id", "string", false, "导出任务 ID"},
	}},
	"POST /api/admin/v1/users/{id}/phone/reveal": {Kind: "props", Props: []fieldSpec{
		{"phone", "string", false, "完整手机号"},
	}},
	"POST /api/admin/v1/forward-tasks/{id}/retry-failed": {Kind: "props", Props: []fieldSpec{
		{"retried", "integer", false, "重试数量"},
	}},
	"POST /api/admin/v1/sensitive-words/import": {Kind: "props", Props: []fieldSpec{
		{"imported", "integer", false, "导入数量"},
	}},
}

// successResponseSchema 生成统一响应信封 + 各接口 data 结构
func successResponseSchema(method, p string) map[string]any {
	key := strings.ToUpper(method) + " " + openapiPath(p)
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"code":      map[string]any{"type": "integer", "description": "0=成功"},
			"message":   map[string]any{"type": "string"},
			"data":      dataSchemaFor(key, method),
			"requestId": map[string]any{"type": "string"},
		},
		"required": []string{"code", "message", "data", "requestId"},
	}
}

// dataSchemaFor 各接口响应 data 的 schema
func dataSchemaFor(key, method string) map[string]any {
	d, ok := responseData[key]
	if !ok {
		if method != "GET" {
			return okData()
		}
		return map[string]any{}
	}
	switch d.Kind {
	case "page":
		return pageData(d.Model)
	case "array":
		return arrayData(d.Model)
	case "ref":
		return refData(d.Model)
	case "props":
		return objectSchema(key, d.Props)
	}
	return map[string]any{}
}

// pageData 分页结构 {items,total,page,pageSize}
func pageData(model string) map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"items":    map[string]any{"type": "array", "items": refData(model)},
			"total":    map[string]any{"type": "integer"},
			"page":     map[string]any{"type": "integer"},
			"pageSize": map[string]any{"type": "integer"},
		},
		"required": []string{"items", "total", "page", "pageSize"},
	}
}

// arrayData 数组结构
func arrayData(model string) map[string]any {
	if model == "" {
		return map[string]any{"type": "array", "items": map[string]any{"type": "object"}}
	}
	return map[string]any{"type": "array", "items": refData(model)}
}

// refData 引用模型 schema
func refData(model string) map[string]any {
	return map[string]any{"$ref": "#/components/schemas/" + model}
}

// okData 通用写操作返回 {ok:true}
func okData() map[string]any {
	return map[string]any{
		"type":       "object",
		"properties": map[string]any{"ok": map[string]any{"type": "boolean"}},
		"required":   []string{"ok"},
	}
}

// ===== 业务模型 schema 定义 =====

// modelSchemas 业务模型字段定义（key = schema 名），用于 components/schemas
var modelSchemas = map[string][]fieldSpec{
	// ---- 模块 01 管理员与 RBAC ----
	"AdminAccount": {
		{"id", "string", false, "管理员 ID"},
		{"username", "string", false, "登录账号"},
		{"nickname", "string", false, "昵称"},
		{"status", "string", false, "active|disabled"},
		{"roleNames", "array", false, "角色名列表"},
		{"roleIds", "array", false, "角色 ID 列表"},
		{"mfaEnabled", "boolean", false, "是否已启用 MFA"},
		{"lastLoginAt", "string", false, "最后登录时间（可空）"},
		{"createdAt", "string", false, "创建时间"},
	},
	"AdminRole": {
		{"id", "string", false, "角色 ID"},
		{"name", "string", false, "角色名称"},
		{"code", "string", false, "角色编码"},
		{"description", "string", false, "描述"},
		{"status", "string", false, "active|disabled"},
		{"permissions", "array", false, "权限码列表"},
		{"userCount", "integer", false, "关联管理员数"},
		{"createdAt", "string", false, "创建时间"},
	},
	"AdminPermission": {
		{"id", "string", false, "权限 ID"},
		{"code", "string", false, "权限码"},
		{"name", "string", false, "权限名"},
		{"module", "string", false, "所属模块"},
		{"description", "string", false, "描述"},
	},
	"LoginResult": {
		{"token", "string", false, "访问令牌（MFA 场景可能不含）"},
		{"refreshToken", "string", false, "刷新令牌（MFA 场景可能不含）"},
		{"admin", "object", false, "管理员资料"},
		{"mfaChallenge", "string", false, "MFA 挑战凭证（需二次验证时返回）"},
	},
	"MeResult": {
		{"admin", "object", false, "管理员资料"},
		{"permissions", "array", false, "权限码列表"},
	},
	"AuditLog": {
		{"id", "integer", false, "审计 ID"},
		{"adminId", "string", false, "管理员 ID（可空）"},
		{"adminName", "string", false, "管理员昵称"},
		{"action", "string", false, "操作"},
		{"resource", "string", false, "资源类型"},
		{"resourceId", "string", false, "资源 ID"},
		{"reason", "string", false, "操作原因"},
		{"beforeValue", "string", false, "变更前"},
		{"afterValue", "string", false, "变更后"},
		{"ip", "string", false, "IP"},
		{"userAgent", "string", false, "User-Agent"},
		{"requestId", "string", false, "请求 ID"},
		{"result", "string", false, "success|denied|failed"},
		{"createdAt", "string", false, "时间"},
	},
	"LoginLog": {
		{"id", "integer", false, "日志 ID"},
		{"adminId", "string", false, "管理员 ID（可空）"},
		{"adminName", "string", false, "管理员昵称"},
		{"success", "boolean", false, "是否成功"},
		{"failReason", "string", false, "失败原因"},
		{"ip", "string", false, "IP"},
		{"userAgent", "string", false, "User-Agent"},
		{"requestId", "string", false, "请求 ID"},
		{"createdAt", "string", false, "时间"},
	},
	// ---- 模块 10 运行观测 ----
	"ErrorEvent": {
		{"id", "integer", false, "事件 ID"},
		{"service", "string", false, "服务"},
		{"level", "string", false, "级别"},
		{"message", "string", false, "消息"},
		{"fingerprint", "string", false, "指纹"},
		{"count", "integer", false, "出现次数"},
		{"firstAt", "string", false, "首次时间"},
		{"lastAt", "string", false, "最后时间"},
	},
	"ExportJob": {
		{"id", "string", false, "任务 ID"},
		{"resource", "string", false, "导出资源"},
		{"filters", "string", false, "过滤条件 JSON"},
		{"status", "string", false, "pending|processing|ready|failed|expired"},
		{"fileUrl", "string", false, "下载地址（可空）"},
		{"createdAt", "string", false, "创建时间"},
		{"finishedAt", "string", false, "完成时间（可空）"},
		{"expiresAt", "string", false, "过期时间（可空）"},
	},
	// ---- 模块 08 配置 ----
	"AppVersion": {
		{"id", "string", false, "版本 ID"},
		{"platform", "string", false, "android|ios"},
		{"version", "string", false, "版本号"},
		{"description", "string", false, "更新说明"},
		{"downloadUrl", "string", false, "下载地址"},
		{"forceUpgrade", "boolean", false, "是否强制升级"},
		{"status", "string", false, "draft|published"},
		{"createdAt", "string", false, "创建时间"},
	},
	"LegalDocument": {
		{"id", "string", false, "协议 ID"},
		{"type", "string", false, "user_agreement|privacy_policy"},
		{"version", "string", false, "版本号"},
		{"language", "string", false, "语言"},
		{"title", "string", false, "标题"},
		{"contentUrl", "string", false, "内容 URL"},
		{"status", "string", false, "draft|published"},
		{"publishedAt", "string", false, "发布时间（可空）"},
	},
	"ReportReason": {
		{"id", "string", false, "原因 ID"},
		{"targetType", "string", false, "user|group|message"},
		{"reason", "string", false, "原因文案"},
		{"language", "string", false, "语言"},
		{"sortOrder", "integer", false, "排序"},
		{"status", "string", false, "active|disabled"},
	},
	"SystemLimits": {
		{"maxFileSizeMb", "integer", false, "单文件大小上限(MB)"},
		{"maxGroupMembers", "integer", false, "单群成员数上限"},
		{"recallWindowSec", "integer", false, "消息撤回时间窗(秒)"},
		{"maxForwardTargets", "integer", false, "单次转发目标数上限"},
		{"maxNicknameLen", "integer", false, "昵称最大长度"},
	},
	// ---- 模块 02 工作台 ----
	"DashboardOverview": {
		{"users", "integer", false, "用户总数"},
		{"activeToday", "integer", false, "今日活跃"},
		{"groups", "integer", false, "群总数"},
		{"messagesToday", "integer", false, "今日消息"},
		{"forwardTasks", "integer", false, "转发任务总数"},
		{"smsSentToday", "integer", false, "今日短信"},
		{"pendingReports", "integer", false, "待处理举报"},
	},
	"DashboardTrend": {
		{"date", "string", false, "日期 YYYY-MM-DD"},
		{"registrations", "integer", false, "注册数"},
		{"active", "integer", false, "活跃数"},
		{"messages", "integer", false, "消息数"},
		{"reports", "integer", false, "举报数"},
		{"forwards", "integer", false, "转发数"},
	},
	"DashboardTodo": {
		{"id", "string", false, "ID"},
		{"type", "string", false, "report|forward_risk|sms_failed|system_alert"},
		{"title", "string", false, "标题"},
		{"targetId", "string", false, "目标 ID（可空）"},
		{"createdAt", "string", false, "时间"},
	},
	// ---- 模块 06 转发 ----
	"ForwardTask": {
		{"id", "string", false, "任务 ID"},
		{"userId", "string", false, "发起用户 ID"},
		{"contentType", "string", false, "内容类型"},
		{"contentSummary", "string", false, "内容摘要"},
		{"status", "string", false, "pending|processing|success|failed|cancelled"},
		{"targetCount", "integer", false, "目标数"},
		{"successCount", "integer", false, "成功数"},
		{"failedCount", "integer", false, "失败数"},
		{"skippedCount", "integer", false, "跳过数"},
		{"riskLevel", "string", false, "风险级别"},
		{"createdAt", "string", false, "创建时间"},
		{"finishedAt", "string", false, "完成时间（可空）"},
	},
	"ForwardTarget": {
		{"id", "string", false, "目标 ID"},
		{"userId", "string", false, "接收用户 ID"},
		{"peerType", "string", false, "c2c|group"},
		{"nickname", "string", false, "昵称"},
		{"status", "string", false, "pending|success|failed|skipped|cancelled"},
		{"attempts", "integer", false, "尝试次数"},
		{"messageId", "string", false, "消息 ID（可空）"},
		{"failCode", "string", false, "失败码"},
		{"finishedAt", "string", false, "完成时间（可空）"},
	},
	"ForwardUserLimit": {
		{"userId", "string", false, "用户 ID"},
		{"dailyLimit", "integer", false, "每日上限"},
		{"hourlyLimit", "integer", false, "每小时上限"},
		{"singleTargets", "integer", false, "单次目标上限"},
		{"enabled", "boolean", false, "是否启用"},
		{"effective", "boolean", false, "固定 false；历史配置不参与投递拦截"},
	},
	"ForwardSettings": {
		{"globalQps", "integer", false, "全局 QPS"},
		{"workerConcurrency", "integer", false, "Worker 并发"},
		{"claimBatchSize", "integer", false, "领取批次"},
		{"perUserConcurrency", "integer", false, "单用户并发"},
		{"retryBaseSeconds", "integer", false, "初始重试秒数"},
		{"retryMaxSeconds", "integer", false, "最大重试秒数"},
		{"processingLockSeconds", "integer", false, "处理锁秒数"},
		{"queuePaused", "boolean", false, "是否暂停消费"},
		{"retentionDays", "integer", false, "保留天数"},
		{"queueAlertDepth", "integer", false, "积压告警阈值"},
	},
	"ForwardQueueMetrics": {
		{"queued", "integer", false, "排队数"},
		{"retrying", "integer", false, "重试数"},
		{"processing", "integer", false, "处理中数量"},
		{"permanentFailed", "integer", false, "永久失败数"},
		{"oldestPendingSeconds", "integer", false, "最老等待秒数"},
		{"sendRatePerSecond", "number", false, "最近一分钟平均发送速率"},
	},
	// ---- 模块 04 群组 ----
	"AppGroup": {
		{"id", "string", false, "群 ID"},
		{"name", "string", false, "群名"},
		{"avatar", "string", false, "群头像"},
		{"ownerId", "string", false, "群主 ID"},
		{"ownerName", "string", false, "群主昵称"},
		{"memberCount", "integer", false, "成员数"},
		{"status", "string", false, "normal|banned|dismissed|muted"},
		{"allMuted", "boolean", false, "是否全员禁言"},
		{"createdAt", "string", false, "创建时间"},
	},
	"AppGroupDetail": {
		{"id", "string", false, "群 ID"},
		{"name", "string", false, "群名"},
		{"avatar", "string", false, "群头像"},
		{"ownerId", "string", false, "群主 ID"},
		{"ownerName", "string", false, "群主昵称"},
		{"memberCount", "integer", false, "成员数"},
		{"status", "string", false, "normal|banned|dismissed|muted"},
		{"allMuted", "boolean", false, "是否全员禁言"},
		{"createdAt", "string", false, "创建时间"},
		{"joinMode", "string", false, "加入方式：direct|approval"},
		{"allowMemberAddFriend", "boolean", false, "是否允许群内互加好友"},
		{"announcement", "string", false, "群公告"},
	},
	"AppGroupMember": {
		{"userId", "string", false, "用户 ID"},
		{"nickname", "string", false, "昵称"},
		{"role", "string", false, "member|owner"},
		{"mutedUntil", "string", false, "禁言截止（可空）"},
		{"joinedAt", "string", false, "入群时间"},
	},
	"RecallLog": {
		{"id", "integer", false, "记录 ID"},
		{"messageId", "string", false, "消息 ID"},
		{"groupId", "string", false, "群 ID"},
		{"operatorType", "string", false, "admin|user"},
		{"operatorName", "string", false, "操作者昵称"},
		{"reason", "string", false, "撤回原因"},
		{"createdAt", "string", false, "时间"},
	},
	// ---- 模块 09 敏感词审核 ----
	"SensitiveWord": {
		{"id", "string", false, "词 ID"},
		{"word", "string", false, "敏感词"},
		{"category", "string", false, "分类"},
		{"status", "string", false, "active|disabled"},
		{"createdAt", "string", false, "创建时间"},
	},
	"ModerationHit": {
		{"id", "integer", false, "记录 ID"},
		{"userId", "string", false, "用户 ID（可空）"},
		{"field", "string", false, "命中字段"},
		{"content", "string", false, "命中内容"},
		{"matchedWord", "string", false, "命中的敏感词"},
		{"category", "string", false, "分类"},
		{"disposition", "string", false, "处置"},
		{"createdAt", "string", false, "时间"},
	},
	"ProfileModeration": {
		{"id", "integer", false, "记录 ID"},
		{"userId", "string", false, "用户 ID"},
		{"field", "string", false, "avatar|nickname"},
		{"oldValue", "string", false, "原值"},
		{"newValue", "string", false, "新值"},
		{"status", "string", false, "pending|approved|rejected"},
		{"reason", "string", false, "处理原因"},
		{"handledAt", "string", false, "处理时间（可空）"},
	},
	// ---- 模块 05 举报 ----
	"Report": {
		{"id", "string", false, "举报 ID"},
		{"reportNo", "string", false, "编号"},
		{"reporterId", "string", false, "举报人 ID（可空）"},
		{"targetType", "string", false, "user|group|message"},
		{"targetId", "string", false, "目标 ID"},
		{"reasonText", "string", false, "举报原因"},
		{"description", "string", false, "描述"},
		{"status", "string", false, "pending|processing|resolved|rejected|reopened"},
		{"assigneeId", "string", false, "处理人 ID（可空）"},
		{"conclusion", "string", false, "结论（可空）"},
		{"actionTaken", "string", false, "处置动作（可空）"},
		{"createdAt", "string", false, "创建时间"},
		{"updatedAt", "string", false, "更新时间"},
	},
	"ReportFile": {
		{"id", "string", false, "文件 ID"},
		{"fileUrl", "string", false, "文件 URL"},
		{"contentType", "string", false, "类型"},
		{"messageId", "string", false, "消息 ID"},
	},
	"ReportNote": {
		{"id", "integer", false, "备注 ID"},
		{"adminId", "string", false, "管理员 ID（可空）"},
		{"content", "string", false, "内容"},
		{"createdAt", "string", false, "时间"},
	},
	"ReportDetail": {
		{"id", "string", false, "举报 ID"},
		{"reportNo", "string", false, "编号"},
		{"reporterId", "string", false, "举报人 ID（可空）"},
		{"targetType", "string", false, "user|group|message"},
		{"targetId", "string", false, "目标 ID"},
		{"reasonText", "string", false, "举报原因"},
		{"description", "string", false, "描述"},
		{"status", "string", false, "pending|processing|resolved|rejected|reopened"},
		{"assigneeId", "string", false, "处理人 ID（可空）"},
		{"conclusion", "string", false, "结论（可空）"},
		{"actionTaken", "string", false, "处置动作（可空）"},
		{"createdAt", "string", false, "创建时间"},
		{"updatedAt", "string", false, "更新时间"},
		{"files", "array", false, "证据文件列表"},
		{"notes", "array", false, "备注列表"},
	},
	"ReportAction": {
		{"id", "integer", false, "记录 ID"},
		{"adminId", "string", false, "管理员 ID（可空）"},
		{"action", "string", false, "操作"},
		{"beforeStatus", "string", false, "变更前状态"},
		{"afterStatus", "string", false, "变更后状态"},
		{"detail", "string", false, "详情"},
		{"createdAt", "string", false, "时间"},
	},
	// ---- 模块 07 国家短信 ----
	"Country": {
		{"code", "string", false, "国家码"},
		{"dialCode", "string", false, "区号"},
		{"cnName", "string", false, "中文名"},
		{"enName", "string", false, "英文名"},
		{"phoneRule", "string", false, "号码规则"},
		{"enabled", "boolean", false, "是否启用"},
		{"sortOrder", "integer", false, "排序"},
	},
	"SmsLog": {
		{"id", "integer", false, "日志 ID"},
		{"phoneMasked", "string", false, "脱敏手机号"},
		{"countryCode", "string", false, "国家码"},
		{"scene", "string", false, "场景"},
		{"status", "string", false, "状态"},
		{"errorCode", "string", false, "错误码"},
		{"provider", "string", false, "供应商"},
		{"createdAt", "string", false, "时间"},
	},
	"SmsStatPoint": {
		{"date", "string", false, "日期"},
		{"total", "integer", false, "总量"},
		{"success", "integer", false, "成功"},
		{"failed", "integer", false, "失败"},
	},
	"SmsStatistics": {
		{"total", "integer", false, "总量"},
		{"success", "integer", false, "成功"},
		{"failed", "integer", false, "失败"},
		{"deliveredRate", "number", false, "送达率"},
		{"byDate", "array", false, "按日统计"},
	},
	"ProviderHealth": {
		{"provider", "string", false, "供应商"},
		{"healthy", "boolean", false, "是否健康"},
		{"latencyMs", "integer", false, "延迟(ms)"},
	},
	// ---- 模块 03 用户 ----
	"AppUser": {
		{"id", "string", false, "用户 ID"},
		{"publicId", "string", false, "公共 ID"},
		{"phoneMasked", "string", false, "脱敏手机号"},
		{"countryCode", "string", false, "国家码"},
		{"nickname", "string", false, "昵称"},
		{"avatar", "string", false, "头像"},
		{"status", "string", false, "active|banned|cancelled"},
		{"loginBanned", "boolean", false, "登录限制"},
		{"messageBanned", "boolean", false, "发消息限制"},
		{"friendCount", "integer", false, "好友数"},
		{"groupCount", "integer", false, "群数"},
		{"reportCount", "integer", false, "被举报数"},
		{"createdAt", "string", false, "注册时间"},
	},
	"AppUserDetail": {
		{"id", "string", false, "用户 ID"},
		{"publicId", "string", false, "公共 ID"},
		{"phoneMasked", "string", false, "脱敏手机号"},
		{"countryCode", "string", false, "国家码"},
		{"nickname", "string", false, "昵称"},
		{"avatar", "string", false, "头像"},
		{"status", "string", false, "active|banned|cancelled"},
		{"loginBanned", "boolean", false, "登录限制"},
		{"messageBanned", "boolean", false, "发消息限制"},
		{"friendCount", "integer", false, "好友数"},
		{"groupCount", "integer", false, "群数"},
		{"reportCount", "integer", false, "被举报数"},
		{"createdAt", "string", false, "注册时间"},
		{"bio", "string", false, "个性签名"},
		{"groupIds", "array", false, "加入的群 ID 列表"},
	},
}

// allSchemas 组装 components/schemas（信封 + 请求体 + 全部业务模型）
func allSchemas() map[string]any {
	schemas := map[string]any{
		"AdminResponse": map[string]any{"type": "object", "properties": map[string]any{
			"code":      map[string]any{"type": "integer", "description": "0=成功"},
			"message":   map[string]any{"type": "string"},
			"data":      map[string]any{},
			"requestId": map[string]any{"type": "string"},
		}},
		"AdminActionRequest": map[string]any{"type": "object", "required": []string{"reason"}, "properties": map[string]any{
			"reason":         map[string]any{"type": "string", "description": "操作原因（所有写操作必填）"},
			"ticketNo":       map[string]any{"type": "string", "description": "关联工单号"},
			"idempotencyKey": map[string]any{"type": "string", "description": "幂等键（高风险操作）"},
		}},
	}
	for name, fields := range modelSchemas {
		schemas[name] = objectSchema(name, fields)
	}
	return schemas
}
