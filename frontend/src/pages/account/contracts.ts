export const accountTabs = [
  ['profile', '我的画像', 'user'],
  ['push', '比赛推送', 'mail'],
  ['follows', '关注的比赛', 'bookmark'],
  ['keys', '搜索与密钥', 'key'],
  ['settings', '账号', 'settings'],
] as const
export type AccountTab = (typeof accountTabs)[number][0]
