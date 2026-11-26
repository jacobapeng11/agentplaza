function readFlag(key: 'IsAdmin' | 'McpEnabled' | 'WecomBotEnabled' | 'SkillEnabled'): boolean {
  try {
    return JSON.parse(localStorage.getItem('userInfo') || '{}')?.[key] === true
  } catch {
    return false
  }
}

// These flags control UI visibility. The server authorizes each operation independently.
export const isAppAdmin = () => readFlag('IsAdmin')
export const isMcpEnabled = () => readFlag('McpEnabled')
export const isWecomBotEnabled = () => readFlag('WecomBotEnabled')
export const isSkillEnabled = () => readFlag('SkillEnabled')
