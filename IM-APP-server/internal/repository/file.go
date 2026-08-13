package repository

import (
	"context"

	"im-app-server/internal/models"

	"github.com/jackc/pgx/v5/pgxpool"
)

type FileRepo struct {
	DB *pgxpool.Pool
}

// CreateFile 创建上传记录（pending）
func (r *FileRepo) CreateFile(ctx context.Context, ownerID, purpose, fileName, contentType, objectKey, sha256, url string, size int64) (models.FileObject, error) {
	var f models.FileObject
	err := r.DB.QueryRow(ctx, `
		INSERT INTO files(owner_id, purpose, object_key, content_type, size, sha256, status, url)
		VALUES($1::uuid,$2,$3,$4,$5,$6,'pending',$7)
		RETURNING id::text, purpose, content_type, size, status, url`,
		ownerID, purpose, objectKey, contentType, size, sha256, url,
	).Scan(&f.ID, &f.Purpose, &f.ContentType, &f.Size, &f.Status, &f.URL)
	f.FileName = fileName
	return f, err
}

// MarkReady 标记上传完成（仅 pending → ready）
func (r *FileRepo) MarkReady(ctx context.Context, fileID string) (models.FileObject, error) {
	var f models.FileObject
	err := r.DB.QueryRow(ctx, `
		UPDATE files SET status='ready'
		WHERE id=$1::uuid AND status='pending'
		RETURNING id::text, purpose, content_type, size, status, url`,
		fileID,
	).Scan(&f.ID, &f.Purpose, &f.ContentType, &f.Size, &f.Status, &f.URL)
	return f, err
}

// FindByID 查询已完成的文件（ready）
func (r *FileRepo) FindByID(ctx context.Context, fileID string) (models.FileObject, error) {
	var f models.FileObject
	err := r.DB.QueryRow(ctx, `
		SELECT id::text, purpose, content_type, size, status, url
		FROM files WHERE id=$1::uuid AND status='ready'`,
		fileID,
	).Scan(&f.ID, &f.Purpose, &f.ContentType, &f.Size, &f.Status, &f.URL)
	return f, err
}
