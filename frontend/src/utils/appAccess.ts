import { ElMessageBox } from 'element-plus';
import type { AppNew } from '../types/agent';

/**
 * 生成无权限提示中的创建人文案。
 */
export function formatAppCreator(app: AppNew | null | undefined): string {
  const creator = app?.creator;
  const badge = String(creator?.Badge ?? '').trim();
  const name = String(creator?.Name ?? '').trim();

  if (badge === 'Owner') {
    return '平台管理员';
  }
  if (name && badge && name !== badge) {
    return `${name}（${badge}）`;
  }
  return name || badge || '应用创建人或平台管理员';
}

/**
 * 打开应用前检查广场接口返回的使用权标记。
 * 旧接口未返回 canAccess 时保持兼容；明确为 false 时展示联系创建人提示。
 */
export async function ensureAppAccessBeforeOpen(app: AppNew | null | undefined): Promise<boolean> {
  if (!app || app.canAccess !== false) {
    return true;
  }

  const creatorText = formatAppCreator(app);
  await ElMessageBox.alert(
    `你暂时没有“${app.name || '该应用'}”的使用权限，请联系 ${creatorText} 添加权限。`,
    '暂无应用权限',
    {
      type: 'warning',
      confirmButtonText: '我知道了',
      closeOnClickModal: true
    }
  );
  return false;
}
