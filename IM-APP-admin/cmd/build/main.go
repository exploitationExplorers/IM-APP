// 命令：交叉编译并打包管理后台 release（Linux amd64）。
// 用法：cd IM-APP-admin && go run ./cmd/build
// 产物：release/im-admin-ubuntu-amd64.tar.gz（含二进制 + migrations + 部署文件）
package main

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const (
	binDir = "release/im-app-admin"
	tgz    = "release/im-admin-ubuntu-amd64.tar.gz"
)

func main() {
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		fatal("创建目录失败", err)
	}
	if err := buildBinary(); err != nil {
		fatal("编译失败", err)
	}
	if err := syncMigrations(); err != nil {
		fatal("同步 migrations 失败", err)
	}
	if err := packTgz(); err != nil {
		fatal("打包失败", err)
	}
	fmt.Println("完成：release/im-admin-ubuntu-amd64.tar.gz")
}

func fatal(prefix string, err error) {
	fmt.Fprintf(os.Stderr, "%s: %v\n", prefix, err)
	os.Exit(1)
}

// buildBinary 交叉编译 Linux amd64 静态二进制
func buildBinary() error {
	cmd := exec.Command("go", "build", "-o", filepath.Join(binDir, "im-app-admin"), "./cmd/admin")
	cmd.Env = append(os.Environ(), "GOOS=linux", "GOARCH=amd64", "CGO_ENABLED=0")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%v\n%s", err, out)
	}
	fmt.Println("✓ 已编译", filepath.Join(binDir, "im-app-admin"))
	return nil
}

// syncMigrations 把源码 migrations 下所有 .sql 同步到打包目录
func syncMigrations() error {
	entries, err := os.ReadDir("migrations")
	if err != nil {
		return err
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		if err := copyFile(filepath.Join("migrations", e.Name()), filepath.Join(binDir, "migrations", e.Name())); err != nil {
			return err
		}
	}
	fmt.Println("✓ migrations 已同步到", filepath.Join(binDir, "migrations"))
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

// packTgz 把打包目录打成 tar.gz（二进制设执行位 0755，其余 0644）
func packTgz() error {
	f, err := os.Create(tgz)
	if err != nil {
		return err
	}
	defer f.Close()
	gz := gzip.NewWriter(f)
	defer gz.Close()
	tw := tar.NewWriter(gz)
	defer tw.Close()

	return filepath.Walk(binDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(binDir, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil // 根目录条目不写入
		}
		name := "./" + filepath.ToSlash(rel)
		if info.IsDir() {
			return tw.WriteHeader(&tar.Header{Name: name + "/", Mode: 0o755, Typeflag: tar.TypeDir})
		}
		hdr := &tar.Header{Name: name, Mode: 0o644, Size: info.Size(), ModTime: info.ModTime()}
		if info.Name() == "im-app-admin" {
			hdr.Mode = 0o755 // 二进制可执行
		}
		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		defer file.Close()
		_, err = io.Copy(tw, file)
		return err
	})
}
