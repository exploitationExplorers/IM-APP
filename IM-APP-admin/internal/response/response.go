package response

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// RequestIDKey 请求 ID 在 gin context 中的键
const RequestIDKey = "requestId"

// Body 统一管理端响应（清单 3.1）
type Body struct {
	Code      int    `json:"code"`
	Message   string `json:"message"`
	Data      any    `json:"data"`
	RequestID string `json:"requestId"`
}

// Page 统一分页结构（清单 3.1）
type Page struct {
	Items    any   `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"pageSize"`
}

// AdminActionRequest 写操作统一请求（清单 3.1）
type AdminActionRequest struct {
	Reason         string `json:"reason" binding:"required"`
	TicketNo       string `json:"ticketNo,omitempty"`
	IdempotencyKey string `json:"idempotencyKey"`
}

func requestID(c *gin.Context) string {
	if v, ok := c.Get(RequestIDKey); ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// OK 成功返回
func OK(c *gin.Context, data any) {
	c.JSON(http.StatusOK, Body{Code: 0, Message: "ok", Data: data, RequestID: requestID(c)})
}

// OKPage 成功分页返回
func OKPage(c *gin.Context, items any, total int64, page, pageSize int) {
	c.JSON(http.StatusOK, Body{
		Code:      0,
		Message:   "ok",
		Data:      Page{Items: items, Total: total, Page: page, PageSize: pageSize},
		RequestID: requestID(c),
	})
}

// Fail 失败返回（默认业务错误码 1）
func Fail(c *gin.Context, httpStatus int, message string) {
	FailWithCode(c, httpStatus, 1, message)
}

// FailWithCode 失败返回（自定义业务错误码；400 系列用 HTTP 状态码作为业务语义）
func FailWithCode(c *gin.Context, httpStatus, code int, message string) {
	c.JSON(httpStatus, Body{Code: code, Message: message, Data: nil, RequestID: requestID(c)})
}

// Forbidden 越权 403
func Forbidden(c *gin.Context, message string) {
	Fail(c, http.StatusForbidden, message)
}

// Unauthorized 401
func Unauthorized(c *gin.Context, message string) {
	Fail(c, http.StatusUnauthorized, message)
}

// BadRequest 400
func BadRequest(c *gin.Context, message string) {
	Fail(c, http.StatusBadRequest, message)
}
