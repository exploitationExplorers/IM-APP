package handler

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"im-app-server/internal/middleware"
	"im-app-server/internal/repository"
	"im-app-server/internal/response"
)

type RetentionVisibilityReader interface {
	VisibilityForMember(context.Context, string, []string) ([]repository.RetentionVisibility, error)
}

type GroupRetentionHandler struct{ Reader RetentionVisibilityReader }

// States only reads published cleanup results. It cannot create jobs, apply a
// preview, select a user identity, or authorize message/object deletion.
func (h *GroupRetentionHandler) States(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	query, parseErr := url.ParseQuery(c.Request.URL.RawQuery)
	values := query["conversationIds"]
	if parseErr != nil || len(query) != 1 || len(values) != 1 || len(values[0]) > 1799 || c.Request.ContentLength != 0 {
		response.Fail(c, http.StatusBadRequest, "请在 query 中提供 conversationIds")
		return
	}
	ids := strings.Split(values[0], ",")
	if len(ids) < 1 || len(ids) > 50 {
		response.Fail(c, http.StatusBadRequest, "每次查询 1 至 50 个群")
		return
	}
	groups := make([]string, 0, len(ids))
	seen := map[string]bool{}
	for _, id := range ids {
		if !strings.HasPrefix(id, "sg_") || len(id) != 35 {
			response.Fail(c, http.StatusBadRequest, "群会话 ID 不正确")
			return
		}
		parsed, err := uuid.Parse(id[3:])
		if err != nil || strings.ReplaceAll(parsed.String(), "-", "") != id[3:] || seen[id] {
			response.Fail(c, http.StatusBadRequest, "群会话 ID 不正确或重复")
			return
		}
		seen[id] = true
		groups = append(groups, parsed.String())
	}
	items, err := h.Reader.VisibilityForMember(c.Request.Context(), middleware.UserID(c), groups)
	if err != nil {
		response.Fail(c, http.StatusServiceUnavailable, "群历史同步暂不可用，请重试")
		return
	}
	if items == nil {
		items = []repository.RetentionVisibility{}
	}
	response.OK(c, gin.H{"items": items})
}
