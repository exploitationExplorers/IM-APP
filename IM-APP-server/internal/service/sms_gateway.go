package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/aliyun/alibaba-cloud-sdk-go/sdk"
	"github.com/aliyun/alibaba-cloud-sdk-go/sdk/requests"
)

// SMSGateway sends real SMS via third-party provider.
type SMSGateway interface {
	Send(ctx context.Context, phone, countryCode, code, scene string) error
}

// DevSMSGateway logs SMS in dev; production uses AliyunSMSGateway.
type DevSMSGateway struct{}

func (DevSMSGateway) Send(ctx context.Context, phone, countryCode, code, scene string) error {
	log.Printf("[sms-dev] phone=%s country=%s scene=%s code=%s", phone, countryCode, scene, code)
	return nil
}

// AliyunSMSGateway 阿里云短信服务（Dysmsapi SendSms）
type AliyunSMSGateway struct {
	AccessKeyID     string
	AccessKeySecret string
	SignName        string // 短信签名
	TemplateCode    string // 短信模板 Code
	RegionID        string
}

func (g *AliyunSMSGateway) Send(ctx context.Context, phone, countryCode, code, scene string) error {
	client, err := sdk.NewClientWithAccessKey(g.RegionID, g.AccessKeyID, g.AccessKeySecret)
	if err != nil {
		return err
	}
	tplParam, _ := json.Marshal(map[string]string{"code": code})
	req := requests.NewCommonRequest()
	req.Method = "POST"
	req.Scheme = "https"
	req.Domain = "dysmsapi.aliyuncs.com"
	req.Version = "2017-05-25"
	req.ApiName = "SendSms"
	req.QueryParams["PhoneNumbers"] = phone
	req.QueryParams["SignName"] = g.SignName
	req.QueryParams["TemplateCode"] = g.TemplateCode
	req.QueryParams["TemplateParam"] = string(tplParam)

	resp, err := client.ProcessCommonRequest(req)
	if err != nil {
		return err
	}
	var out struct {
		Code    string `json:"Code"`
		Message string `json:"Message"`
	}
	_ = json.Unmarshal(resp.GetHttpContentBytes(), &out)
	if out.Code != "OK" {
		return fmt.Errorf("aliyun sms: %s %s", out.Code, out.Message)
	}
	return nil
}
