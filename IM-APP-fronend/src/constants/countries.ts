export interface CountryOption {
  code: string
  name: string
  dialCode: string
  /** 手机号长度提示（不含区号） */
  phonePattern: RegExp
  placeholder: string
}

export const COUNTRY_LIST: CountryOption[] = [
  {
    code: 'CN',
    name: '中国',
    dialCode: '+86',
    phonePattern: /^1\d{10}$/,
    placeholder: '请输入手机号码',
  },
  {
    code: 'HK',
    name: '中国香港',
    dialCode: '+852',
    phonePattern: /^\d{8}$/,
    placeholder: '请输入 8 位手机号码',
  },
  {
    code: 'US',
    name: '美国',
    dialCode: '+1',
    phonePattern: /^\d{10}$/,
    placeholder: '请输入 10 位手机号码',
  },
  {
    code: 'SG',
    name: '新加坡',
    dialCode: '+65',
    phonePattern: /^\d{8}$/,
    placeholder: '请输入 8 位手机号码',
  },
  {
    code: 'MY',
    name: '马来西亚',
    dialCode: '+60',
    phonePattern: /^\d{9,10}$/,
    placeholder: '请输入手机号码',
  },
]

export function findCountryByDialCode(dialCode: string): CountryOption {
  return COUNTRY_LIST.find((c) => c.dialCode === dialCode) || COUNTRY_LIST[0]
}

export function validatePhone(dialCode: string, phone: string): boolean {
  const country = findCountryByDialCode(dialCode)
  return country.phonePattern.test(phone)
}
