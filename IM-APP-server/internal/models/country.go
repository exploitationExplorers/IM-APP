package models

// CountryItem 国家/地区区号（登录前可查询）
type CountryItem struct {
	Code     string `json:"code"`
	DialCode string `json:"dialCode"`
	CNName   string `json:"cnName"`
	ENName   string `json:"enName"`
	Enabled  bool   `json:"enabled"`
}
