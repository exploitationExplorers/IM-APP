package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// OSSMedia keeps DB/media URLs stable while a private OSS GET signature expires.
// The signed token grants access to this one key, matching existing link semantics.
func (h *FileHandler) OSSMedia(c *gin.Context) {
	if h.Storage == nil || h.Storage.OSS == nil {
		c.Status(http.StatusServiceUnavailable)
		return
	}
	u, err := h.Storage.OSS.ResolveMedia(c.Request.Context(), c.Query("key"), c.Query("token"))
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.Header("Referrer-Policy", "no-referrer")
	c.Redirect(http.StatusFound, u)
}
