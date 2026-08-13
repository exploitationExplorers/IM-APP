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
		MetaH:     &handler.MetaHandler{Version: "1.0.0", Commit: "dev"},
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
				"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/AdminResponse"}},
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
			"description": "按《GOAL-管理后台分模块开发清单(1).md》实现。除 /health、/auth/login、/auth/mfa/verify 外，均需在请求头携带 `Authorization: Bearer <token>`。统一响应 `{code, message, data, requestId}`，code=0 成功；列表接口 data 为 `{items, total, page, pageSize}`。",
		},
		"servers": []map[string]any{{"url": "http://localhost:8090/api/admin/v1"}},
		"tags":    buildTags(),
		"paths":   paths,
		"components": map[string]any{
			"securitySchemes": map[string]any{
				"BearerAuth": map[string]any{"type": "http", "scheme": "bearer", "bearerFormat": "JWT"},
			},
			"schemas": map[string]any{
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
			},
		},
		"security": []map[string]any{{"BearerAuth": []any{}}},
	}
}

// isPublic 判断是否为无需鉴权的公共接口
func isPublic(p string) bool {
	return p == "/api/admin/v1/health" ||
		strings.HasSuffix(p, "/auth/login") ||
		strings.HasSuffix(p, "/auth/mfa/verify")
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
			out = append(out, map[string]any{
				"name":     strings.TrimPrefix(s, ":"),
				"in":       "path",
				"required": true,
				"schema":   map[string]any{"type": "string"},
			})
		}
	}
	return out
}

func queryParams(method, p string) []any {
	out := make([]any, 0)
	if method != "GET" || strings.Contains(p, "/:") {
		return out
	}
	// 列表/详情查询通用参数
	out = append(out,
		param("page", "query", "页码（默认1）", "integer", false),
		param("size", "query", "每页条数（默认20，最大100）", "integer", false),
	)
	if strings.Contains(p, "/users") || strings.Contains(p, "/groups") ||
		strings.Contains(p, "/reports") || strings.Contains(p, "/sms/logs") ||
		strings.Contains(p, "/forward-tasks") || strings.Contains(p, "/sensitive-words") ||
		strings.Contains(p, "/audit-logs") || strings.Contains(p, "/countries") {
		out = append(out, param("keyword", "query", "关键字（按各资源匹配）", "string", false))
	}
	if strings.Contains(p, "/users") || strings.Contains(p, "/groups") ||
		strings.Contains(p, "/reports") || strings.Contains(p, "/forward-tasks") ||
		strings.Contains(p, "/sms/logs") || strings.Contains(p, "/moderation/profiles") {
		out = append(out, param("status", "query", "状态筛选", "string", false))
	}
	return out
}

func param(name, in, desc, typ string, required bool) map[string]any {
	return map[string]any{
		"name":        name,
		"in":          in,
		"description": desc,
		"required":    required,
		"schema":      map[string]any{"type": typ},
	}
}

// requestBody 写操作统一要求 reason；登录/刷新/二次验证给专用结构
func requestBody(method, p string) any {
	if method == "GET" || method == "DELETE" {
		return nil
	}
	ref := func(schema string) any {
		return map[string]any{
			"required": true,
			"content":  map[string]any{"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/" + schema}}},
		}
	}
	switch {
	case strings.Contains(p, "/auth/login"):
		return map[string]any{"required": true, "content": map[string]any{"application/json": map[string]any{"schema": map[string]any{
			"type": "object", "required": []string{"username", "password"},
			"properties": map[string]any{
				"username": map[string]any{"type": "string"},
				"password": map[string]any{"type": "string"},
			},
		}}}}
	case strings.Contains(p, "/auth/mfa/verify"):
		return map[string]any{"required": true, "content": map[string]any{"application/json": map[string]any{"schema": map[string]any{
			"type": "object", "required": []string{"challengeToken", "code"},
			"properties": map[string]any{
				"challengeToken": map[string]any{"type": "string"},
				"code":           map[string]any{"type": "string", "description": "6位验证码"},
			},
		}}}}
	case strings.Contains(p, "/auth/token/refresh"), strings.Contains(p, "/auth/logout"):
		return map[string]any{"required": true, "content": map[string]any{"application/json": map[string]any{"schema": map[string]any{
			"type": "object", "required": []string{"refreshToken"},
			"properties": map[string]any{"refreshToken": map[string]any{"type": "string"}},
		}}}}
	default:
		return ref("AdminActionRequest")
	}
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
	"GET /api/admin/v1/health":                                "后台存活检查",
	"GET /api/admin/v1/meta":                                  "后台版本、commit、构建时间与功能开关",
	"POST /api/admin/v1/auth/login":                           "管理员密码登录（启用 MFA 时返回挑战凭证）",
	"POST /api/admin/v1/auth/mfa/verify":                      "MFA 二次验证，验证通过后签发正式 token",
	"POST /api/admin/v1/auth/token/refresh":                   "用 refresh token 刷新 access token（自动轮换）",
	"POST /api/admin/v1/auth/logout":                          "退出当前后台会话",
	"POST /api/admin/v1/auth/logout-all":                      "退出当前管理员全部后台会话",
	"GET /api/admin/v1/me":                                    "获取当前管理员资料与权限列表",
	"PUT /api/admin/v1/me/password":                           "修改本人登录密码",
	"GET /api/admin/v1/me/mfa":                                "查看本人 MFA 状态（未启用时返回绑定密钥）",
	"POST /api/admin/v1/me/mfa/setup":                         "验证 TOTP 码后启用 MFA",
	"POST /api/admin/v1/me/mfa/disable":                       "验证 TOTP 码后关闭 MFA",
	"GET /api/admin/v1/admins":                                "管理员列表（按关键字/分页）",
	"POST /api/admin/v1/admins":                               "创建管理员（密码至少6位，可分配角色）",
	"PATCH /api/admin/v1/admins/{id}":                         "修改管理员（昵称/密码/角色/状态）",
	"PUT /api/admin/v1/admins/{id}/status":                    "启用/停用管理员（停用时其全部会话立即失效）",
	"POST /api/admin/v1/admins/{id}/mfa/reset":                "重置指定管理员的 MFA",
	"GET /api/admin/v1/roles":                                 "角色列表（含权限码）",
	"POST /api/admin/v1/roles":                                "创建角色并分配权限",
	"PUT /api/admin/v1/roles/{id}":                            "修改角色信息与权限",
	"DELETE /api/admin/v1/roles/{id}":                         "删除角色（内置 super_admin 不可删除）",
	"GET /api/admin/v1/permissions":                           "权限码字典列表",
	"GET /api/admin/v1/audit-logs":                            "管理操作审计日志（按关键字/结果/资源筛选）",
	"GET /api/admin/v1/audit-logs/{id}":                       "审计日志详情",
	"GET /api/admin/v1/admin-login-logs":                      "管理员登录日志",
	"GET /api/admin/v1/dashboard/overview":                    "工作台核心概览（用户/活跃/群/消息/转发/短信/待办举报）",
	"GET /api/admin/v1/dashboard/trends":                      "按日趋势统计（注册/活跃/消息/举报/转发）",
	"GET /api/admin/v1/dashboard/todos":                       "工作台待办列表（待处理举报/转发风险/系统告警）",
	"GET /api/admin/v1/users":                                 "用户列表（按关键字/状态筛选，手机号已脱敏）",
	"GET /api/admin/v1/users/{id}":                            "用户详情（资料/好友/群/限制/举报统计）",
	"POST /api/admin/v1/users/{id}/phone/reveal":              "查看完整手机号（需权限+原因+工单号，动作审计）",
	"GET /api/admin/v1/users/{id}/groups":                     "用户加入的群列表",
	"GET /api/admin/v1/users/{id}/reports":                    "用户被举报记录",
	"GET /api/admin/v1/users/{id}/forward-tasks":              "用户的转发任务记录",
	"PUT /api/admin/v1/users/{id}/login-restriction":          "设置/解除用户登录限制",
	"PUT /api/admin/v1/users/{id}/message-restriction":        "设置/解除用户发消息限制",
	"PUT /api/admin/v1/users/{id}/ban":                        "封禁/解封用户（封禁撤销其全部登录会话）",
	"POST /api/admin/v1/users/{id}/sessions/revoke":           "强制用户全部设备下线",
	"GET /api/admin/v1/groups":                                "群列表（按关键字/状态筛选）",
	"GET /api/admin/v1/groups/{id}":                           "群详情（设置/公告/全员禁言等）",
	"GET /api/admin/v1/groups/{id}/members":                   "群成员列表",
	"GET /api/admin/v1/groups/{id}/reports":                   "群被举报记录",
	"PUT /api/admin/v1/groups/{id}/mute-all":                  "设置/解除群全员禁言",
	"PUT /api/admin/v1/groups/{id}/member-add-friend":         "设置群内成员互加好友开关",
	"POST /api/admin/v1/groups/{id}/dissolve":                 "解散违规群（高风险，需原因）",
	"GET /api/admin/v1/groups/{id}/recall-logs":               "群内管理撤回记录",
	"POST /api/admin/v1/groups/{id}/messages/{messageId}/recall": "管理撤回指定消息（需关联原因/工单）",
	"GET /api/admin/v1/reports":                               "举报列表（按状态/目标类型/关键字筛选）",
	"GET /api/admin/v1/reports/{id}":                          "举报详情（含证据/备注）",
	"POST /api/admin/v1/reports/{id}/assign":                  "指派/领取举报工单",
	"POST /api/admin/v1/reports/{id}/start":                   "标记举报为处理中",
	"POST /api/admin/v1/reports/{id}/notes":                   "补充举报内部备注",
	"POST /api/admin/v1/reports/{id}/resolve":                 "举报成立并结案（记录结论与处置动作）",
	"POST /api/admin/v1/reports/{id}/reject":                  "举报驳回并结案",
	"POST /api/admin/v1/reports/{id}/reopen":                  "重新打开已结案工单",
	"GET /api/admin/v1/reports/{id}/actions":                  "举报处置历史记录",
	"GET /api/admin/v1/forward-tasks":                         "转发任务列表（成功/失败/跳过统计）",
	"GET /api/admin/v1/forward-tasks/{id}":                    "转发任务详情",
	"GET /api/admin/v1/forward-tasks/{id}/targets":            "转发任务目标明细分页",
	"GET /api/admin/v1/forward-tasks/{id}/failures":           "转发失败原因统计",
	"POST /api/admin/v1/forward-tasks/{id}/cancel":            "终止待处理转发任务（已成功消息不撤回）",
	"POST /api/admin/v1/forward-tasks/{id}/retry-failed":      "重试失败转发目标",
	"GET /api/admin/v1/forward-limits/users/{userId}":         "查看用户转发限额",
	"PUT /api/admin/v1/forward-limits/users/{userId}":         "修改用户转发限额（需审计）",
	"GET /api/admin/v1/forward-settings":                      "获取全局转发规则",
	"PUT /api/admin/v1/forward-settings":                      "修改全局转发规则",
	"GET /api/admin/v1/countries":                             "国家/地区列表",
	"POST /api/admin/v1/countries":                            "新增国家/地区",
	"PUT /api/admin/v1/countries/{code}/status":               "启用/停用国家注册",
	"GET /api/admin/v1/sms/logs":                              "短信发送日志（手机号脱敏）",
	"GET /api/admin/v1/sms/logs/{id}":                         "短信日志详情",
	"GET /api/admin/v1/sms/statistics":                        "短信送达统计（按日）",
	"GET /api/admin/v1/sms/providers/health":                  "短信供应商健康状态",
	"GET /api/admin/v1/app-versions":                          "APP 版本列表",
	"POST /api/admin/v1/app-versions":                         "创建 APP 版本",
	"PUT /api/admin/v1/app-versions/{id}":                     "修改 APP 版本",
	"PUT /api/admin/v1/app-versions/{id}/status":              "发布/下线 APP 版本",
	"GET /api/admin/v1/legal-documents":                       "协议文档列表（用户协议/隐私政策）",
	"POST /api/admin/v1/legal-documents":                      "创建协议版本",
	"POST /api/admin/v1/legal-documents/{id}/publish":         "发布协议版本",
	"GET /api/admin/v1/report-reasons":                        "举报原因列表",
	"POST /api/admin/v1/report-reasons":                       "新建举报原因",
	"PUT /api/admin/v1/report-reasons/{id}":                   "修改举报原因",
	"PUT /api/admin/v1/report-reasons/{id}/status":            "启用/停用举报原因（被引用只能停用）",
	"GET /api/admin/v1/system-limits":                         "获取系统限制配置（已发布）",
	"PUT /api/admin/v1/system-limits":                         "保存系统限制草稿",
	"POST /api/admin/v1/system-limits/publish":                "发布系统限制配置（版本化）",
	"GET /api/admin/v1/sensitive-words":                       "敏感词列表",
	"POST /api/admin/v1/sensitive-words":                      "新建敏感词",
	"POST /api/admin/v1/sensitive-words/import":               "批量导入敏感词",
	"PUT /api/admin/v1/sensitive-words/{id}":                  "修改敏感词",
	"PUT /api/admin/v1/sensitive-words/{id}/status":           "启用/停用敏感词",
	"GET /api/admin/v1/moderation/hits":                       "敏感词命中记录",
	"GET /api/admin/v1/moderation/profiles":                   "待审核头像/昵称列表",
	"POST /api/admin/v1/moderation/profiles/{userId}/reject":  "驳回头像/昵称（需原因）",
	"POST /api/admin/v1/moderation/profiles/{userId}/restore": "恢复资料状态",
	"GET /api/admin/v1/system/errors":                         "运行错误列表",
	"GET /api/admin/v1/system/errors/{id}":                    "运行错误详情",
	"POST /api/admin/v1/exports":                              "创建异步导出任务",
	"GET /api/admin/v1/exports":                               "查询/下载导出任务列表",
}
