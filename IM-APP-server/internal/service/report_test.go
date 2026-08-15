package service

import (
	"context"
	"errors"
	"testing"

	"im-app-server/internal/models"
)

func TestReportServiceRejectsInvalidRequestsBeforeDatabase(t *testing.T) {
	service := &ReportService{}
	reporterID := "10223cf6-59ec-4556-8c09-141915e190ed"
	targetID := "8ef20bd3-b858-4ec5-9239-075fa2dba7ab"
	reasonID := "547fb4ee-6fe7-4811-a490-a34debd31bf3"

	tests := []models.CreateReportRequest{
		{TargetType: "group", TargetID: targetID, ReasonID: reasonID},
		{TargetType: "user", TargetID: "bad-id", ReasonID: reasonID},
		{TargetType: "user", TargetID: targetID, ReasonID: "bad-id"},
		{TargetType: "user", TargetID: targetID, ReasonID: reasonID, Description: string(make([]rune, 1001))},
	}
	for _, request := range tests {
		_, err := service.Create(context.Background(), reporterID, request)
		if !errors.Is(err, ErrInvalidReportRequest) {
			t.Fatalf("request %#v error = %v", request, err)
		}
	}

	_, err := service.Create(context.Background(), reporterID, models.CreateReportRequest{
		TargetType: "user", TargetID: reporterID, ReasonID: reasonID,
	})
	if !errors.Is(err, ErrCannotReportSelf) {
		t.Fatalf("self report error = %v", err)
	}
}
