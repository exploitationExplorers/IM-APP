package im

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
)

// SeqRange 描述一次按 seq 区间拉取消息的请求。
type SeqRange struct {
	ConversationID string
	Begin          int64
	End            int64
	Num            int
}

// RecentMessage 是返回给 APP 的最近消息，serialized 已整理成客户端可直接渲染的结构。
type RecentMessage struct {
	ClientMsgID    string `json:"clientMsgId"`
	SendID         string `json:"sendId"`
	SenderNickname string `json:"senderNickname"`
	SenderFaceURL  string `json:"senderFaceUrl"`
	ContentType    int    `json:"contentType"`
	SendTime       int64  `json:"sendTime"`
	Seq            int64  `json:"seq"`
	Preview        string `json:"preview"`
	Serialized     string `json:"serialized"`
}

// PullMessagesBySeqRanges 一次请求多个会话的最近 seq 区间。
// 区间由调用方限制为最近 N 条，order 固定 0；返回后由上层按 seq 升序排序。
func (c *Client) PullMessagesBySeqRanges(ctx context.Context, userID string, ranges []SeqRange) (map[string][]json.RawMessage, error) {
	if strings.TrimSpace(userID) == "" || len(ranges) == 0 {
		return nil, errors.New("invalid pull message request")
	}
	seqRanges := make([]map[string]any, 0, len(ranges))
	for _, item := range ranges {
		if strings.TrimSpace(item.ConversationID) == "" || item.Begin <= 0 || item.End < item.Begin || item.Num <= 0 {
			return nil, errors.New("invalid pull message range")
		}
		seqRanges = append(seqRanges, map[string]any{
			"conversationID": item.ConversationID,
			"begin":          item.Begin,
			"end":            item.End,
			"num":            item.Num,
		})
	}
	var data struct {
		Msgs map[string]struct {
			Upper []json.RawMessage `json:"Msgs"`
			Lower []json.RawMessage `json:"msgs"`
		} `json:"msgs"`
	}
	if err := c.postWithAdmin(ctx, "/msg/pull_msg_by_seq", map[string]any{
		"userID":    userID,
		"seqRanges": seqRanges,
		"order":     0,
	}, &data); err != nil {
		return nil, err
	}
	result := make(map[string][]json.RawMessage, len(data.Msgs))
	for conversationID, bucket := range data.Msgs {
		items := bucket.Upper
		if len(items) == 0 {
			items = bucket.Lower
		}
		result[conversationID] = items
	}
	return result, nil
}

type rawRecentMessage struct {
	ClientMsgID    string          `json:"clientMsgID"`
	ServerMsgID    string          `json:"serverMsgID"`
	SendID         string          `json:"sendID"`
	RecvID         string          `json:"recvID"`
	GroupID        string          `json:"groupID"`
	SenderNickname string          `json:"senderNickname"`
	SenderFaceURL  string          `json:"senderFaceUrl"`
	ContentType    int             `json:"contentType"`
	SendTime       int64           `json:"sendTime"`
	CreateTime     int64           `json:"createTime"`
	Seq            int64           `json:"seq"`
	SessionType    int             `json:"sessionType"`
	Content        json.RawMessage `json:"content"`
}

// NormalizeRecentMessage 把 OpenIM MsgData 转成客户端 ChatMessage 所需的 JSON。
// content 在 OpenIM 响应里既可能是 JSON 字符串，也可能是对象，这里统一展开到对应 *Elem 字段。
func NormalizeRecentMessage(raw json.RawMessage) (RecentMessage, bool) {
	var source rawRecentMessage
	if err := json.Unmarshal(raw, &source); err != nil || strings.TrimSpace(source.ClientMsgID) == "" {
		return RecentMessage{}, false
	}
	if source.SendTime <= 0 {
		source.SendTime = source.CreateTime
	}
	contentBytes := normalizeContent(source.Content)
	content := map[string]any{}
	_ = json.Unmarshal(contentBytes, &content)
	serialized := map[string]any{
		"clientMsgID":    source.ClientMsgID,
		"serverMsgID":    source.ServerMsgID,
		"sendID":         source.SendID,
		"recvID":         source.RecvID,
		"groupID":        source.GroupID,
		"senderNickname": source.SenderNickname,
		"senderFaceUrl":  source.SenderFaceURL,
		"contentType":    source.ContentType,
		"sendTime":       source.SendTime,
		"createTime":     source.CreateTime,
		"seq":            source.Seq,
		"sessionType":    source.SessionType,
		"status":         2,
		"isRead":         false,
		"content":        string(contentBytes),
	}
	if field := recentElemField(source.ContentType); field != "" && len(content) > 0 {
		serialized[field] = content
	}
	encoded, err := json.Marshal(serialized)
	if err != nil {
		return RecentMessage{}, false
	}
	return RecentMessage{
		ClientMsgID:    source.ClientMsgID,
		SendID:         source.SendID,
		SenderNickname: source.SenderNickname,
		SenderFaceURL:  source.SenderFaceURL,
		ContentType:    source.ContentType,
		SendTime:       source.SendTime,
		Seq:            source.Seq,
		Preview:        recentPreview(source.ContentType, content),
		Serialized:     string(encoded),
	}, true
}

func normalizeContent(raw json.RawMessage) []byte {
	value := strings.TrimSpace(string(raw))
	if value == "" || value == "null" {
		return []byte("{}")
	}
	if strings.HasPrefix(value, "\"") {
		var content string
		if json.Unmarshal(raw, &content) == nil && strings.TrimSpace(content) != "" {
			return []byte(content)
		}
		return []byte("{}")
	}
	return []byte(value)
}

func recentElemField(contentType int) string {
	switch contentType {
	case 101:
		return "textElem"
	case 102:
		return "pictureElem"
	case 103:
		return "soundElem"
	case 104:
		return "videoElem"
	case 105:
		return "fileElem"
	case 106:
		return "atTextElem"
	case 107:
		return "mergeElem"
	case 108:
		return "cardElem"
	case 109:
		return "locationElem"
	case 110:
		return "customElem"
	case 114:
		return "quoteElem"
	case 115:
		return "advancedTextElem"
	case 118:
		return "faceElem"
	default:
		return ""
	}
}

func recentPreview(contentType int, content map[string]any) string {
	switch contentType {
	case 101, 115:
		if text, ok := content["content"].(string); ok && strings.TrimSpace(text) != "" {
			return text
		}
		return "[文本]"
	case 102:
		return "[图片]"
	case 103:
		return "[语音]"
	case 104:
		return "[视频]"
	case 105:
		return "[文件]"
	case 106:
		return "[提及消息]"
	case 107:
		return "[合并消息]"
	case 108:
		return "[名片]"
	case 109:
		return "[位置]"
	case 110:
		return "[自定义消息]"
	case 114:
		return "[引用消息]"
	case 118:
		return "[表情]"
	default:
		return "[消息]"
	}
}
