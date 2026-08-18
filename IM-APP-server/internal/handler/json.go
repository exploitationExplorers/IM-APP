package handler

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"

	"github.com/gin-gonic/gin"
)

const maxBusinessJSONBodyBytes = 64 << 10

func bindBusinessJSON(c *gin.Context, target any) error {
	mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return errors.New("content type must be application/json")
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBusinessJSONBodyBytes)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("request body must contain one JSON value")
		}
		return err
	}
	return nil
}
