/**
 * 外链应用表单验证规则
 * 统一的表单验证逻辑，可在编辑器和其他表单中复用
 */

import type { FormRules } from 'element-plus'

// URL验证正则
const URL_REGEX = /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/

// Badge验证正则（字母数字组合）
const BADGE_REGEX = /^[a-zA-Z0-9]+$/

// 部门代码验证正则
const DEPT_CODE_REGEX = /^[A-Z0-9\-]+$/

/**
 * 验证URL格式
 */
export const validateUrl = (rule: any, value: string, callback: any) => {
  if (!value) {
    callback(new Error('请输入应用链接'))
  } else if (!URL_REGEX.test(value)) {
    callback(new Error('请输入有效的 http:// 或 https:// 链接'))
  } else {
    callback()
  }
}

/**
 * 验证应用名称
 */
export const validateName = (rule: any, value: string, callback: any) => {
  if (!value) {
    callback(new Error('请输入应用名称'))
  } else if (value.length < 2) {
    callback(new Error('应用名称至少2个字符'))
  } else if (value.length > 50) {
    callback(new Error('应用名称最多50个字符'))
  } else {
    callback()
  }
}

/**
 * 验证应用简介
 */
export const validateIntro = (rule: any, value: string, callback: any) => {
  if (!value) {
    callback(new Error('请输入应用简介'))
  } else if (value.length < 10) {
    callback(new Error('应用简介至少10个字符'))
  } else if (value.length > 500) {
    callback(new Error('应用简介最多500个字符'))
  } else {
    callback()
  }
}

/**
 * 验证标签数组
 */
export const validateTags = (rule: any, value: string[], callback: any) => {
  if (!value || value.length === 0) {
    callback(new Error('请至少添加一个标签'))
  } else if (value.length > 4) {
    callback(new Error('最多添加4个标签'))
  } else if (value.some(tag => tag.length > 20)) {
    callback(new Error('单个标签最多20个字符'))
  } else {
    callback()
  }
}

/**
 * 验证人员权限数组
 */
export const validateUserPermissions = (rule: any, value: string[], callback: any) => {
  if (!value || value.length === 0) {
    callback() // 允许为空（公开应用）
  } else if (value.some(badge => !BADGE_REGEX.test(badge))) {
    callback(new Error('人员 Badge 只能包含字母和数字'))
  } else {
    callback()
  }
}

/**
 * 验证部门权限数组
 */
export const validateDeptPermissions = (rule: any, value: string[], callback: any) => {
  if (!value || value.length === 0) {
    callback() // 允许为空（公开应用）
  } else if (value.length > 20) {
    callback(new Error('最多选择20个部门'))
  } else {
    callback()
  }
}

/**
 * 验证图片URL
 */
export const validateAvatar = (rule: any, value: string, callback: any) => {
  if (!value) {
    callback(new Error('请上传应用图标'))
  } else if (!URL_REGEX.test(value)) {
    callback(new Error('请输入有效的图片链接'))
  } else {
    callback()
  }
}

/**
 * 外链应用表单验证规则
 */
export const linkAppFormRules: FormRules = {
  name: [
    { required: true, validator: validateName, trigger: 'blur' }
  ],
  appUrl: [
    { required: true, validator: validateUrl, trigger: 'blur' }
  ],
  intro: [
    { required: true, validator: validateIntro, trigger: 'blur' }
  ],
  newType: [
    { required: true, message: '请选择应用分类', trigger: 'change' }
  ],
  tags: [
    { required: true, validator: validateTags, trigger: 'change' }
  ],
  avatar: [
    { required: true, validator: validateAvatar, trigger: 'change' }
  ],
  userPermissions: [
    { validator: validateUserPermissions, trigger: 'change' }
  ],
  deptPermissions: [
    { validator: validateDeptPermissions, trigger: 'change' }
  ]
}

/**
 * 验证图片文件
 */
export const validateImageFile = (file: File): { valid: boolean; error?: string } => {
  const validTypes = ['image/jpeg', 'image/png', 'image/gif']
  const maxSize = 2 * 1024 * 1024 // 2MB

  if (!validTypes.includes(file.type)) {
    return {
      valid: false,
      error: '只支持上传 JPG、PNG、GIF 格式的图片'
    }
  }

  if (file.size > maxSize) {
    return {
      valid: false,
      error: '图片大小不能超过 2MB'
    }
  }

  return { valid: true }
}

/**
 * 格式化文件大小
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
}
