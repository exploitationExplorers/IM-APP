package service

import (
	"context"

	"im-app-server/internal/models"
	"im-app-server/internal/repository"
	"im-app-server/internal/ws"
)

type ChatService struct {
	Chat *repository.ChatRepo
	Hub  *ws.Hub
}

func (s *ChatService) ListConversations(ctx context.Context, uid string) ([]models.Conversation, error) {
	return s.Chat.ListConversations(ctx, uid)
}

func (s *ChatService) ListMessages(ctx context.Context, uid, convID string) ([]models.Message, error) {
	ok, err := s.Chat.IsMember(ctx, convID, uid)
	if err != nil || !ok {
		return nil, ErrForbidden
	}
	list, err := s.Chat.ListMessages(ctx, convID)
	if err != nil {
		return nil, err
	}
	_ = s.Chat.MarkConversationRead(ctx, convID, uid)
	return list, nil
}

func (s *ChatService) SendMessage(ctx context.Context, uid, convID, msgType, content string) (models.Message, error) {
	if msgType == "" {
		msgType = "text"
	}
	ok, err := s.Chat.IsMember(ctx, convID, uid)
	if err != nil || !ok {
		return models.Message{}, ErrForbidden
	}
	m, err := s.Chat.SendMessage(ctx, convID, uid, msgType, content)
	if err != nil {
		return m, err
	}
	if s.Hub != nil {
		memberIDs, _ := s.Chat.ListConversationMemberIDs(ctx, convID)
		s.Hub.BroadcastToConversation(convID, memberIDs, ws.Envelope{
			Event: "chat.message",
			Data:  m,
		})
	}
	return m, nil
}

func (s *ChatService) ReadAll(ctx context.Context, uid string) error {
	return s.Chat.ReadAll(ctx, uid)
}
