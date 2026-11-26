/**
 * 标签工具函数
 * 用于处理应用标签的显示逻辑
 */

/**
 * 根据应用分类生成对应的分类标签
 * @param category - 应用分类（newType 或 type）
 * @returns 分类标签名称
 */
export function getCategoryTag(category: string | undefined): string {
  if (!category) return '';
  
  // 直接使用分类名称作为标签
  return category;
}

/**
 * 获取应用的完整标签列表（分类标签 + 原有标签）
 * @param app - 应用对象，包含 newType/type 和 tags 字段
 * @returns 完整的标签数组，分类标签在最前面
 */
export function getAppTags(app: any): string[] {
  if (!app) return [];
  
  // 获取分类（优先使用 newType，兼容 type）
  const category = app.newType || app.type;
  const categoryTag = getCategoryTag(category);
  
  // 获取原有标签
  const originalTags = Array.isArray(app.tags) ? app.tags : [];
  
  // 如果没有分类标签，直接返回原有标签
  if (!categoryTag) {
    return originalTags;
  }
  
  // 如果原有标签中已经包含分类标签，不重复添加
  if (originalTags.includes(categoryTag)) {
    return originalTags;
  }
  
  // 分类标签放在最前面
  return [categoryTag, ...originalTags];
}

/**
 * 获取应用的显示标签列表（带数量限制）
 * @param app - 应用对象
 * @param maxCount - 最多显示的标签数量，默认为 4
 * @returns 显示的标签数组
 */
export function getDisplayTags(app: any, maxCount: number = 4): string[] {
  const allTags = getAppTags(app);
  return allTags.slice(0, maxCount);
}
