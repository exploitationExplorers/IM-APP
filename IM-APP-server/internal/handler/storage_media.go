package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"im-app-server/internal/infra"
)

// OSSMedia keeps DB/media URLs stable while a private OSS GET signature expires.
// The signed token grants access to this one key, matching existing link semantics.
func (h *FileHandler) OSSMedia(c *gin.Context) {
	if h.Storage == nil || h.Storage.OSS == nil {
		c.Status(http.StatusServiceUnavailable)
		return
	}
	u, err := h.Storage.OSS.ResolveMedia(c.Request.Context(), c.Query("key"), c.Query("token"), c.Query("variant"))
	if err != nil {
		if errors.Is(err, infra.ErrInvalidMediaVariant) {
			c.Status(http.StatusBadRequest)
			return
		}
		c.Status(http.StatusNotFound)
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.Header("Referrer-Policy", "no-referrer")
	c.Redirect(http.StatusFound, u)
}
