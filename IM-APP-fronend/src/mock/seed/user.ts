import type { UserInfo } from '@/types'

export const SEED_USERS: UserInfo[] = [
  {
    id: 'u_me',
    phone: '13800138000',
    countryCode: '+86',
    publicId: 'chat10001',
    nickname: '张三',
    avatar: '/static/avatar-me.png',
    bio: '你好，我是张三',
    status: 'active',
  },
  {
    id: 'u_1',
    phone: '13800138001',
    countryCode: '+86',
    publicId: 'chat10002',
    nickname: '李四',
    avatar: '/static/avatar-1.png',
    bio: '',
    status: 'active',
  },
  {
    id: 'u_2',
    phone: '13800138002',
    countryCode: '+86',
    publicId: 'chat10003',
    nickname: '王五',
    avatar: '/static/avatar-2.png',
    bio: '',
    status: 'active',
  },
  {
    id: 'u_3',
    phone: '13800138003',
    countryCode: '+86',
    publicId: 'chat10004',
    nickname: '赵六',
    avatar: '/static/avatar-3.png',
    bio: '',
    status: 'active',
  },
]

export const DEMO_PASSWORD = '123456'
