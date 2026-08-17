package repository

import (
	"context"
	"errors"

	"im-app-server/internal/models"

	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrInvalidReportImage = errors.New("invalid report image")

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
func (r *FileRepo) MarkReady(ctx context.Context, fileID, ownerID string) (models.FileObject, error) {
	var f models.FileObject
	err := r.DB.QueryRow(ctx, `
		UPDATE files SET status='ready'
		WHERE id=$1::uuid AND owner_id=$2::uuid AND status='pending'
		RETURNING id::text, purpose, content_type, size, status, url`,
		fileID, ownerID,
	).Scan(&f.ID, &f.Purpose, &f.ContentType, &f.Size, &f.Status, &f.URL)
	return f, err
}

// FindByID 查询已完成的文件（ready）
func (r *FileRepo) FindByID(ctx context.Context, fileID, ownerID string) (models.FileObject, error) {
	var f models.FileObject
	err := r.DB.QueryRow(ctx, `
		SELECT id::text, purpose, content_type, size, status, url
		FROM files WHERE id=$1::uuid AND owner_id=$2::uuid AND status='ready'`,
		fileID, ownerID,
	).Scan(&f.ID, &f.Purpose, &f.ContentType, &f.Size, &f.Status, &f.URL)
	return f, err
}

func (r *FileRepo) FindReadyAvatarByID(ctx context.Context, fileID, ownerID string) (models.FileObject, error) {
	var f models.FileObject
	err := r.DB.QueryRow(ctx, `
		SELECT id::text, purpose, content_type, size, status, url
		FROM files
		WHERE id=$1::uuid AND owner_id=$2::uuid AND status='ready'
		  AND purpose='avatar' AND content_type LIKE 'image/%' AND size <= 10485760`,
		fileID, ownerID,
	).Scan(&f.ID, &f.Purpose, &f.ContentType, &f.Size, &f.Status, &f.URL)
	return f, err
}

// FindReadyReportImagePaths resolves uploaded report images to public, directly accessible URLs.
func (r *FileRepo) FindReadyReportImagePaths(ctx context.Context, fileIDs []string, ownerID string) ([]string, error) {
	paths := make([]string, 0, len(fileIDs))
	for _, fileID := range fileIDs {
		var imagePath string
		err := r.DB.QueryRow(ctx, `
			SELECT url
			FROM files
			WHERE id=$1::uuid AND owner_id=$2::uuid AND status='ready'
			  AND purpose='image' AND content_type LIKE 'image/%'
			  AND size > 0 AND size <= 10485760 AND url <> ''`,
			fileID, ownerID,
		).Scan(&imagePath)
		if err != nil {
			return nil, ErrInvalidReportImage
		}
		paths = append(paths, imagePath)
	}
	return paths, nil
}
