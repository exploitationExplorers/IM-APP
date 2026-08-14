package service

// 本文件已按领域拆分为：
//   - user.go：DataService 结构体与用户方法
//   - group.go：群组方法
//   - report.go：举报方法与 joinActions
//
// 此处仅保留包级共享符号：ErrNotFound 与 NowRef。

import (
	"errors"
	"time"
)

var ErrNotFound = errors.New("记录不存在")

// NowRef 返回当前时间指针（供 handler 使用）
func NowRef() *time.Time {
	t := time.Now().UTC()
	return &t
}
