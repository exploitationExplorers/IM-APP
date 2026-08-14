package repository

import (
	"errors"
	"fmt"
	"strings"
)

// ErrNotAffected 行未受影响
var ErrNotAffected = errors.New("not affected")

// parseUUIDSafe 空字符串转 nil
func parseUUIDSafe(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

// wrapErr 统一包装数据库错误
func wrapErr(prefix string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s: %w", prefix, err)
}
