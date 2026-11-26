const Apps = require('../models/Apps');
const ResourcePermissions = require('../models/ResourcePermissions');
const TeamMembers = require('../models/TeamMembers');
const Users = require('../models/Users');
const TeamOrgs = require('../models/TeamOrgs');
const TeamGroupMembers = require('../models/TeamGroupMembers');
const TeamMemberGroups = require('../models/TeamMemberGroups');
const TeamOrgMembers = require('../models/TeamOrgMembers');
const { resolveAdminBadges } = require('../config/adminBadges');

const ADMIN_BADGES = resolveAdminBadges();
const FASTGPT_MANAGE_ROLE_VALUE = 0b001;
const FASTGPT_WRITE_ROLE_VALUE = 0b010;
const FASTGPT_READ_ROLE_VALUE = 0b100;
const FASTGPT_OWNER_ROLE_VALUE = ~0 >>> 0;
const FASTGPT_WRITE_COMPATIBLE_ROLE_MASK = FASTGPT_MANAGE_ROLE_VALUE | FASTGPT_WRITE_ROLE_VALUE;
const FASTGPT_READ_COMPATIBLE_ROLE_MASK = FASTGPT_MANAGE_ROLE_VALUE | FASTGPT_WRITE_ROLE_VALUE | FASTGPT_READ_ROLE_VALUE;
const DEFAULT_MEMBER_GROUP_NAME = 'DEFAULT_GROUP';
const FASTGPT_INACTIVE_TEAM_MEMBER_STATUSES = new Set(['leave', 'forbidden']);

/**
 * 执行 Mongoose 查询或普通 Promise。
 * 输入: Mongoose Query、thenable 或普通值。
 * 输出: 查询解析后的文档对象。
 */
async function executeQuery(query) {
  if (query && typeof query.exec === 'function') {
    return query.exec();
  }

  return query;
}

/**
 * 执行 find().lean() 查询。
 * 输入: Mongoose 模型和查询条件。
 * 输出: lean 后的文档数组。
 */
async function findLean(Model, query, selectFields = null) {
  let request = Model.find(query);
  if (selectFields && request && typeof request.select === 'function') {
    const selectedRequest = request.select(selectFields);
    request = selectedRequest || request;
  }
  if (request && typeof request.lean === 'function') {
    const leanRequest = request.lean();
    request = leanRequest || request;
  }

  return executeQuery(request);
}

/**
 * 执行 findById().lean() 查询。
 * 输入: Mongoose 模型和文档 ID。
 * 输出: lean 后的单个文档或 null。
 */
async function findByIdLean(Model, id) {
  let request = Model.findById(id);
  if (request && typeof request.lean === 'function') {
    const leanRequest = request.lean();
    request = leanRequest || request;
  }

  return executeQuery(request);
}

/**
 * 批量执行 find({_id: {$in}}).lean() 查询。
 * 输入: Mongoose 模型和文档 ID 数组。
 * 输出: lean 后的文档数组；模型不支持 find 时回退为逐个 findById。
 */
async function findByIdsLean(Model, ids = []) {
  const uniqueIds = [...new Set((ids || []).map(toIdString).filter(Boolean))];
  if (uniqueIds.length === 0) {
    return [];
  }

  if (Model && typeof Model.find === 'function') {
    return findLean(Model, { _id: { $in: uniqueIds } });
  }

  const documents = await Promise.all(uniqueIds.map((id) => findByIdLean(Model, id)));
  return documents.filter(Boolean);
}

/**
 * 将任意 ID 转为稳定字符串。
 * 输入: ObjectId、字符串、数字或空值。
 * 输出: 可用于比较的字符串。
 */
function toIdString(value) {
  if (value && typeof value.toString === 'function') {
    return value.toString();
  }

  return String(value || '');
}

/**
 * 判断两个 ID 是否相同。
 * 输入: 任意两个 ID 值。
 * 输出: 布尔值，表示字符串化后是否一致。
 */
function sameId(left, right) {
  return Boolean(toIdString(left)) && toIdString(left) === toIdString(right);
}

/**
 * 从用户信息中提取可映射 FastGPT 成员身份的工号候选。
 * 输入: 登录态用户信息。
 * 输出: 去重后的工号字符串数组。
 */
function getBadgeCandidates(userInfo = {}) {
  return [
    userInfo.employeeNumber,
    userInfo.Badge,
    userInfo.badge,
    userInfo.name,
    userInfo.username
  ]
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== '')
    .map((value) => String(value).trim())
    .filter((value, index, allValues) => allValues.indexOf(value) === index);
}

/**
 * 判断 FastGPT 团队成员状态是否仍可参与授权。
 * 输入: team_members 记录。
 * 输出: leave/forbidden 以外的成员返回 true，缺失状态按 FastGPT 查询语义允许。
 */
function isUsableFastgptTeamMember(member = {}) {
  const status = String(member?.status || '').trim().toLowerCase();
  return !FASTGPT_INACTIVE_TEAM_MEMBER_STATUSES.has(status);
}

/**
 * 过滤并去重 FastGPT 团队成员记录。
 * 输入: team_members 文档数组。
 * 输出: 状态可用且 _id 去重后的成员数组。
 */
function dedupeUsableFastgptTeamMembers(members = []) {
  const seenIds = new Set();

  return (members || []).filter((member) => {
    if (!isUsableFastgptTeamMember(member)) {
      return false;
    }

    const memberId = toIdString(member?._id);
    if (!memberId || seenIds.has(memberId)) {
      return false;
    }

    seenIds.add(memberId);
    return true;
  });
}

/**
 * 判断用户是否命中平台管理员白名单。
 * 输入: 登录态用户信息或工号字符串。
 * 输出: 命中管理员白名单时返回 true。
 */
function isAdminOverride(userInfo) {
  const badges = typeof userInfo === 'string' ? [userInfo] : getBadgeCandidates(userInfo || {});
  return badges.some((badge) => ADMIN_BADGES.includes(String(badge)));
}

/**
 * 判断权限记录是否属于指定应用。
 * 输入: resource_permissions 记录和应用 ID。
 * 输出: 记录绑定当前应用时返回 true。
 */
function isPermissionForApp(permission, appId) {
  return sameId(permission?.resourceId, appId);
}

/**
 * 判断 FastGPT 权限角色是否包含写权限。
 * 输入: resource_permissions 记录。
 * 输出: 包含 write、manage 或 owner 角色时返回 true。
 */
function hasFastgptWritePermission(permission) {
  const role = Number(permission?.permission || 0);
  return role === FASTGPT_OWNER_ROLE_VALUE || (role & FASTGPT_WRITE_COMPATIBLE_ROLE_MASK) !== 0;
}

/**
 * 判断 FastGPT 权限角色是否包含应用使用读权限。
 * 输入: resource_permissions 记录。
 * 输出: 包含 read、write、manage 或 owner 角色时返回 true。
 */
function hasFastgptReadPermission(permission) {
  const role = Number(permission?.permission || 0);
  return role === FASTGPT_OWNER_ROLE_VALUE || (role & FASTGPT_READ_COMPATIBLE_ROLE_MASK) !== 0;
}

/**
 * 合并 FastGPT 角色位。
 * 输入: 一个或多个 resource_permissions.permission 数值。
 * 输出: 合并后的角色位，owner 保持无符号 owner 值。
 */
function mergeFastgptRoleValues(...roles) {
  if ((roles || []).some((role) => Number(role) === FASTGPT_OWNER_ROLE_VALUE)) {
    return FASTGPT_OWNER_ROLE_VALUE;
  }

  return (roles || []).reduce((combined, role) => (
    (combined | Number(role || 0)) >>> 0
  ), 0);
}

/**
 * 判断权限记录是否属于指定团队。
 * 输入: resource_permissions 记录和团队 ID。
 * 输出: 记录 teamId 与目标团队一致时返回 true。
 */
function isPermissionForTeam(permission, teamId) {
  return sameId(permission?.teamId, teamId);
}

/**
 * 生成应用使用权需要检查的资源 ID 列表。
 * 输入: Apps 文档。
 * 输出: 当前应用 ID，及启用继承时的父级资源 ID。
 */
function getUsePermissionResourceIds(app) {
  return [
    toIdString(app?._id),
    app?.inheritPermission ? toIdString(app.parentId || app.folderId || app.parentAppId) : ''
  ].filter(Boolean);
}

/**
 * 判断权限记录是否属于允许的资源 ID 集合。
 * 输入: resource_permissions 记录和资源 ID 字符串数组。
 * 输出: 命中当前应用或继承父级资源时返回 true。
 */
function isPermissionForResourceIds(permission, resourceIds = []) {
  return resourceIds.some((resourceId) => sameId(permission?.resourceId, resourceId));
}

/**
 * 从团队成员记录中提取团队 ID 集合。
 * 输入: 当前用户的 team_members 记录。
 * 输出: 用户所在团队 ID 字符串集合。
 */
function getMemberTeamIds(members = []) {
  return new Set((members || []).map((member) => toIdString(member.teamId)).filter(Boolean));
}

/**
 * 从登录态用户信息中生成部门 pathId 候选。
 * 输入: 包含 DepartmentCode/departmentCode/deptCode 的用户信息。
 * 输出: 可用于匹配当前部门及所有上级部门 pathId 的候选字符串数组。
 */
function getDepartmentPathIdCandidates(userInfo = {}) {
  const rawCodes = [
    userInfo.DepartmentCode,
    userInfo.departmentCode,
    userInfo.deptCode
  ]
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== '')
    .map((value) => String(value).trim());

  const candidates = new Set();
  rawCodes.forEach((rawCode) => {
    String(rawCode)
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => {
        for (let index = 1; index <= part.length; index += 1) {
          candidates.add(part.substring(0, index));
        }
      });
  });

  return [...candidates];
}

/**
 * 判断当前成员是否为应用所属团队 Owner。
 * 输入: 应用文档和当前用户的 team_members 记录。
 * 输出: 用户是应用团队 owner 时返回 true。
 */
function isTeamOwnerForApp(app, members = []) {
  return (members || []).some((member) => (
    sameId(member.teamId, app?.teamId)
    && String(member.role || '').toLowerCase() === 'owner'
  ));
}

/**
 * 构建拒绝结果。
 * 输入: 拒绝原因和可选应用文档。
 * 输出: canConfigureWecomBot 标准响应对象。
 */
function deny(reason, app = undefined) {
  return {
    allowed: false,
    reason,
    ...(app ? { app } : {})
  };
}

/**
 * 构建允许结果。
 * 输入: 允许原因、应用文档和可选扩展字段。
 * 输出: canConfigureWecomBot 标准响应对象。
 */
function allow(reason, app, extra = {}) {
  return {
    allowed: true,
    reason,
    app,
    ...extra
  };
}

/**
 * 创建 FastGPT 应用权限服务。
 * 输入: 可注入的 Apps、Users、TeamMembers、ResourcePermissions、TeamOrgs、成员组和部门成员模型。
 * 输出: 成员解析、canConfigureWecomBot、canUseFastgptApp 与 getConfigurableAppIds 权限判断方法。
 */
function createFastgptAppPermissionService({
  AppsModel = Apps,
  UsersModel = Users,
  TeamMembersModel = TeamMembers,
  ResourcePermissionsModel = ResourcePermissions,
  TeamOrgsModel = TeamOrgs,
  TeamGroupMembersModel = TeamGroupMembers,
  TeamMemberGroupsModel = TeamMemberGroups,
  TeamOrgMembersModel = TeamOrgMembers
} = {}) {
  /**
   * 查询当前用户在 team_members 中的身份。
   * 输入: 登录态用户信息。
   * 输出: 优先通过 users._id -> team_members.userId 解析的团队成员记录；旧数据缺失时按 name 兜底。
   */
  async function findUserTeamMembers(userInfo) {
    const badges = getBadgeCandidates(userInfo);
    if (badges.length === 0) {
      return [];
    }

    let stableMembers = [];
    if (UsersModel && typeof UsersModel.find === 'function') {
      const users = await findLean(UsersModel, { username: { $in: badges } });
      const userIds = [...new Set((users || []).map((user) => toIdString(user?._id)).filter(Boolean))];

      if (userIds.length > 0) {
        stableMembers = await findLean(TeamMembersModel, { userId: { $in: userIds } });
      }
    }

    const usableStableMembers = dedupeUsableFastgptTeamMembers(stableMembers);
    if (usableStableMembers.length > 0) {
      return usableStableMembers;
    }

    const fallbackMembers = await findLean(TeamMembersModel, { name: { $in: badges } });
    return dedupeUsableFastgptTeamMembers(fallbackMembers);
  }

  /**
   * 查询指定应用相关的资源权限记录。
   * 输入: Apps 文档。
   * 输出: 当前应用的 resource_permissions 记录数组。
   */
  async function findAppPermissions(app) {
    return findLean(ResourcePermissionsModel, {
      resourceId: app._id,
      resourceType: 'app'
    });
  }

  /**
   * 查询指定应用使用权相关的资源权限记录。
   * 输入: Apps 文档。
   * 输出: 当前应用和可继承父级资源的 resource_permissions 记录数组。
   */
  async function findAppUsePermissions(app) {
    const resourceIds = getUsePermissionResourceIds(app);
    return findLean(ResourcePermissionsModel, {
      resourceId: { $in: resourceIds },
      resourceType: 'app'
    });
  }

  /**
   * 批量查询多个应用相关的资源权限记录。
   * 输入: Apps 文档数组。
   * 输出: 多个应用的 resource_permissions 记录数组。
   */
  async function findPermissionsForApps(apps = []) {
    const appIds = [...new Set((apps || []).map((app) => toIdString(app?._id)).filter(Boolean))];
    if (appIds.length === 0) {
      return [];
    }

    return findLean(ResourcePermissionsModel, {
      resourceId: { $in: appIds },
      resourceType: 'app'
    });
  }

  /**
   * 批量查询多个应用使用权相关的资源权限记录。
   * 输入: Apps 文档数组。
   * 输出: 当前应用及其可继承父级资源的 resource_permissions 记录数组。
   */
  async function findUsePermissionsForApps(apps = []) {
    const resourceIds = [...new Set((apps || [])
      .flatMap((app) => getUsePermissionResourceIds(app))
      .map(toIdString)
      .filter(Boolean))];
    if (resourceIds.length === 0) {
      return [];
    }

    return findLean(ResourcePermissionsModel, {
      resourceId: { $in: resourceIds },
      resourceType: 'app'
    });
  }

  /**
   * Index batched permission records once so large plaza lists do not rescan
   * the full permission array for every application.
   */
  function indexPermissionsByResourceId(permissions = []) {
    const permissionsByResourceId = new Map();

    for (const permission of permissions || []) {
      const resourceId = toIdString(permission?.resourceId);
      if (!resourceId) continue;

      const resourcePermissions = permissionsByResourceId.get(resourceId) || [];
      resourcePermissions.push(permission);
      permissionsByResourceId.set(resourceId, resourcePermissions);
    }

    return permissionsByResourceId;
  }

  function getIndexedPermissions(permissionsByResourceId, resourceIds = []) {
    return [...new Set((resourceIds || []).map(toIdString).filter(Boolean))]
      .flatMap((resourceId) => permissionsByResourceId.get(resourceId) || []);
  }

  /**
   * 查询当前用户所属的 FastGPT 成员组。
   * 输入: 当前用户的 team_members 记录。
   * 输出: 显式成员组与团队默认组 ID 集合。
   */
  async function findUserGroupIdSet(members = []) {
    const memberIds = [...new Set((members || []).map((member) => toIdString(member._id)).filter(Boolean))];
    const teamIds = [...getMemberTeamIds(members)];

    if (memberIds.length === 0 && teamIds.length === 0) {
      return new Set();
    }

    const [groupMembers, defaultGroups] = await Promise.all([
      memberIds.length > 0
        ? findLean(TeamGroupMembersModel, { tmbId: { $in: memberIds } }, 'groupId tmbId')
        : [],
      teamIds.length > 0
        ? findLean(TeamMemberGroupsModel, {
          teamId: { $in: teamIds },
          name: DEFAULT_MEMBER_GROUP_NAME
        }, '_id teamId name')
        : []
    ]);

    return new Set([
      ...(groupMembers || [])
        .filter((groupMember) => memberIds.includes(toIdString(groupMember.tmbId)))
        .map((groupMember) => toIdString(groupMember.groupId))
        .filter(Boolean),
      ...(defaultGroups || [])
        .filter((group) => (
          teamIds.includes(toIdString(group.teamId))
          && String(group.name || '') === DEFAULT_MEMBER_GROUP_NAME
        ))
        .map((group) => toIdString(group._id))
        .filter(Boolean)
    ]);
  }

  /**
   * 查询当前用户所属 FastGPT 部门及其父部门。
   * 输入: 当前用户的 team_members 记录。
   * 输出: 直接部门和父部门 ID 集合。
   */
  async function findUserOrgIdSet(members = [], userInfo = {}) {
    const memberIds = [...new Set((members || []).map((member) => toIdString(member._id)).filter(Boolean))];
    const teamIds = [...getMemberTeamIds(members)];

    if (memberIds.length === 0 || teamIds.length === 0) {
      return new Set();
    }

    const orgMembers = await findLean(TeamOrgMembersModel, {
      teamId: { $in: teamIds },
      tmbId: { $in: memberIds }
    }, 'teamId tmbId orgId');

    const directOrgIds = [...new Set((orgMembers || [])
      .filter((orgMember) => (
        teamIds.includes(toIdString(orgMember.teamId))
        && memberIds.includes(toIdString(orgMember.tmbId))
      ))
      .map((orgMember) => toIdString(orgMember.orgId))
      .filter(Boolean))];

    const departmentPathIds = getDepartmentPathIdCandidates(userInfo);
    const departmentOrgs = departmentPathIds.length > 0
      ? await findLean(TeamOrgsModel, {
        pathId: { $in: departmentPathIds }
      }, '_id teamId path pathId')
      : [];
    const departmentOrgIds = [...new Set((departmentOrgs || [])
      .filter((org) => teamIds.includes(toIdString(org.teamId)))
      .map((org) => toIdString(org._id))
      .filter(Boolean))];

    const seedOrgIds = [...new Set([...directOrgIds, ...departmentOrgIds])];
    if (seedOrgIds.length === 0) {
      return new Set();
    }

    const directOrgs = await findLean(TeamOrgsModel, { _id: { $in: seedOrgIds } }, '_id teamId path pathId');
    const parentPathIds = [...new Set((directOrgs || [])
      .filter((org) => seedOrgIds.includes(toIdString(org._id)))
      .flatMap((org) => String(org.path || '').split('/').filter(Boolean)))];

    // team_orgs.teamId 在 FastGPT 数据中是 ObjectId；先按 pathId 找父部门，再用字符串化 ID 过滤团队，避免 schema 类型漂移导致父部门漏匹配。
    const parentOrgs = parentPathIds.length > 0
      ? await findLean(TeamOrgsModel, {
        pathId: { $in: parentPathIds }
      }, '_id teamId pathId')
      : [];

    return new Set([
      ...seedOrgIds,
      ...(parentOrgs || [])
        .filter((org) => teamIds.includes(toIdString(org.teamId)))
        .map((org) => toIdString(org._id))
        .filter(Boolean)
    ]);
  }

  /**
   * 按 FastGPT 个人权限最高优先级解析权限。
   * 输入: 应用、当前应用权限记录和当前用户团队成员记录。
   * 输出: PERSONAL_PERMISSION、PERSONAL_DENIED 或 null。
   */
  function resolvePersonalPermission(app, permissions, members) {
    const appTeamMembers = (members || []).filter((member) => sameId(member.teamId, app.teamId));
    const appTeamId = toIdString(app.teamId);

    for (const member of appTeamMembers) {
      const personalPermission = (permissions || []).find((permission) => (
        permission.tmbId
        && sameId(permission.tmbId, member._id)
        && isPermissionForApp(permission, app._id)
        && isPermissionForTeam(permission, appTeamId)
      ));

      if (personalPermission) {
        return hasFastgptWritePermission(personalPermission)
          ? 'PERSONAL_PERMISSION'
          : 'PERSONAL_DENIED';
      }
    }

    return null;
  }

  /**
   * 解析 FastGPT 成员组或部门权限。
   * 输入: 应用、当前应用权限记录、成员组 ID 集合和部门 ID 集合。
   * 输出: 命中组/部门写权限时返回允许原因，否则返回 null。
   */
  function resolveSharedPermission(app, permissions, groupIdSet, orgIdSet) {
    const appTeamId = toIdString(app.teamId);

    for (const permission of permissions || []) {
      if (!hasFastgptWritePermission(permission) || !isPermissionForApp(permission, app._id) || !isPermissionForTeam(permission, appTeamId)) {
        continue;
      }

      if (permission.groupId && groupIdSet.has(toIdString(permission.groupId))) {
        return 'GROUP_PERMISSION';
      }

      if (permission.orgId && orgIdSet.has(toIdString(permission.orgId))) {
        return 'DEPARTMENT_PERMISSION';
      }
    }

    return null;
  }

  /**
   * 按 FastGPT 个人权限最高优先级解析应用使用权。
   * 输入: 应用、当前应用/父级权限记录和当前用户团队成员记录。
   * 输出: PERSONAL_PERMISSION、PERSONAL_DENIED 或 null。
   */
  function resolvePersonalUsePermissionForResource(app, resourceId, permissions, members) {
    const appTeamMembers = (members || []).filter((member) => sameId(member.teamId, app.teamId));
    const appTeamId = toIdString(app.teamId);

    for (const member of appTeamMembers) {
      const personalPermission = (permissions || []).find((permission) => (
        permission.tmbId
        && sameId(permission.tmbId, member._id)
        && sameId(permission.resourceId, resourceId)
        && isPermissionForTeam(permission, appTeamId)
      ));

      if (personalPermission) {
        return {
          role: Number(personalPermission.permission || 0),
          found: true,
          reason: hasFastgptReadPermission(personalPermission) ? 'PERSONAL_PERMISSION' : ''
        };
      }
    }

    return { role: 0, found: false, reason: '' };
  }

  /**
   * 解析 FastGPT 成员组或部门应用使用权。
   * 输入: 应用、单个资源 ID、权限记录、成员组 ID 集合和部门 ID 集合。
   * 输出: 当前资源的组合角色位和读权限来源。
   */
  function resolveSharedUsePermissionForResource(app, resourceId, permissions, groupIdSet, orgIdSet) {
    const appTeamId = toIdString(app.teamId);
    const matchedRoles = [];
    let reason = '';

    for (const permission of permissions || []) {
      if (!sameId(permission?.resourceId, resourceId) ||
        !isPermissionForTeam(permission, appTeamId)) {
        continue;
      }

      if (permission.groupId && groupIdSet.has(toIdString(permission.groupId))) {
        matchedRoles.push(Number(permission.permission || 0));
        if (!reason && hasFastgptReadPermission(permission)) {
          reason = 'GROUP_PERMISSION';
        }
      }

      if (permission.orgId && orgIdSet.has(toIdString(permission.orgId))) {
        matchedRoles.push(Number(permission.permission || 0));
        if (!reason && hasFastgptReadPermission(permission)) {
          reason = 'DEPARTMENT_PERMISSION';
        }
      }
    }

    return {
      role: mergeFastgptRoleValues(...matchedRoles),
      found: matchedRoles.length > 0,
      reason
    };
  }

  /**
   * 按 FastGPT getTmbPermission 语义解析单个资源使用权角色。
   * 输入: 应用、资源 ID、权限记录、团队成员、成员组集合和部门集合。
   * 输出: 单资源个人优先后的角色位和读权限来源。
   */
  function resolveUsePermissionForResource(app, resourceId, permissions, members, groupIdSet, orgIdSet) {
    const personalPermission = resolvePersonalUsePermissionForResource(app, resourceId, permissions, members);
    if (personalPermission.found) {
      return personalPermission;
    }

    return resolveSharedUsePermissionForResource(app, resourceId, permissions, groupIdSet, orgIdSet);
  }

  /**
   * 在已预加载上下文中判断单个应用配置权限。
   * 输入: 应用、登录态用户、团队成员、权限记录、成员组集合和部门集合。
   * 输出: 标准权限判断结果。
   */
  function resolvePermissionFromLoadedContext(app, userInfo, members, permissions, groupIdSet, orgIdSet) {
    if (!app) {
      return deny('APP_NOT_FOUND');
    }

    if (isAdminOverride(userInfo)) {
      return allow('ADMIN_OVERRIDE', app, { isAdminOverride: true });
    }

    const memberIds = new Set((members || []).map((member) => toIdString(member._id)));
    if (isTeamOwnerForApp(app, members)) {
      return allow('TEAM_OWNER', app);
    }

    if (memberIds.has(toIdString(app.tmbId))) {
      return allow('APP_CREATOR', app);
    }

    const appPermissions = (permissions || []).filter((permission) => isPermissionForApp(permission, app._id));
    const personalPermissionReason = resolvePersonalPermission(app, appPermissions, members);
    if (personalPermissionReason === 'PERSONAL_PERMISSION') {
      return allow('PERSONAL_PERMISSION', app);
    }

    if (personalPermissionReason === 'PERSONAL_DENIED') {
      return deny('PERMISSION_DENIED', app);
    }

    const sharedPermissionReason = resolveSharedPermission(app, appPermissions, groupIdSet, orgIdSet);
    if (sharedPermissionReason) {
      return allow(sharedPermissionReason, app);
    }

    return deny('PERMISSION_DENIED', app);
  }

  /**
   * 在已预加载上下文中判断单个应用使用权。
   * 输入: 应用、企微绑定用户信息、团队成员、权限记录、成员组集合和部门集合。
   * 输出: 标准权限判断结果。
   */
  function resolveUsePermissionFromLoadedContext(app, userInfo, members, permissions, groupIdSet, orgIdSet) {
    if (!app) {
      return deny('APP_NOT_FOUND');
    }

    if (!members || members.length === 0) {
      return deny('TEAM_MEMBER_NOT_FOUND', app);
    }

    const memberIds = new Set((members || []).map((member) => toIdString(member._id)));
    if (isTeamOwnerForApp(app, members)) {
      return allow('TEAM_OWNER', app);
    }

    if (memberIds.has(toIdString(app.tmbId))) {
      return allow('APP_CREATOR', app);
    }

    const appPermissions = (permissions || []).filter((permission) => (
      isPermissionForResourceIds(permission, getUsePermissionResourceIds(app))
    ));
    const resourceResults = getUsePermissionResourceIds(app).map((resourceId) => (
      resolveUsePermissionForResource(app, resourceId, appPermissions, members, groupIdSet, orgIdSet)
    ));
    const combinedRole = mergeFastgptRoleValues(...resourceResults.map((result) => result.role));
    if (hasFastgptReadPermission({ permission: combinedRole })) {
      const readReason = resourceResults.find((result) => (
        result.reason && hasFastgptReadPermission({ permission: result.role })
      ))?.reason || 'PERSONAL_PERMISSION';
      return allow(readReason, app);
    }

    return deny('PERMISSION_DENIED', app);
  }

  /**
   * 判断当前用户是否可以配置应用的企业微信 Bot。
   * 输入: FastGPT 应用 ID 和登录态用户信息。
   * 输出: { allowed, reason, app?, isAdminOverride? } 权限判断结果。
   */
  async function canConfigureWecomBot(appId, userInfo = {}) {
    try {
      const app = await findByIdLean(AppsModel, appId);
      if (!app) {
        return deny('APP_NOT_FOUND');
      }

      if (isAdminOverride(userInfo)) {
        return allow('ADMIN_OVERRIDE', app, { isAdminOverride: true });
      }

      const members = await findUserTeamMembers(userInfo);
      const [groupIdSet, orgIdSet] = await Promise.all([
        findUserGroupIdSet(members),
        findUserOrgIdSet(members, userInfo)
      ]);

      const permissions = await findAppPermissions(app);
      return resolvePermissionFromLoadedContext(app, userInfo, members, permissions, groupIdSet, orgIdSet);
    } catch (error) {
      return deny('PERMISSION_QUERY_FAILED');
    }
  }

  /**
   * 判断当前企微绑定用户是否可以通过 Bot 使用 FastGPT 应用。
   * 输入: FastGPT 应用 ID 和包含 username/Badge 的用户信息。
   * 输出: { allowed, reason, app? } 权限判断结果，查询异常时 fail closed。
   */
  async function canUseFastgptApp(appId, userInfo = {}) {
    try {
      const app = await findByIdLean(AppsModel, appId);
      if (!app) {
        return deny('APP_NOT_FOUND');
      }

      const members = await findUserTeamMembers(userInfo);
      if (!members || members.length === 0) {
        return deny('TEAM_MEMBER_NOT_FOUND', app);
      }

      const [permissions, groupIdSet, orgIdSet] = await Promise.all([
        findAppUsePermissions(app),
        findUserGroupIdSet(members),
        findUserOrgIdSet(members, userInfo)
      ]);

      return resolveUsePermissionFromLoadedContext(app, userInfo, members, permissions, groupIdSet, orgIdSet);
    } catch (error) {
      return deny('PERMISSION_QUERY_FAILED');
    }
  }

  /**
   * 批量筛选当前用户可配置企业微信 Bot 的应用 ID。
   * 输入: FastGPT 应用 ID 数组、登录态用户信息，以及可选的已加载应用文档（避免重复查询）。
   * 输出: 允许配置的应用 ID Set。
   */
  async function getConfigurableAppIds(appIds = [], userInfo = {}, preloadedApps = null) {
    const allowedAppIds = new Set();
    const uniqueAppIds = [...new Set((appIds || []).map(toIdString).filter(Boolean))];
    if (uniqueAppIds.length === 0) {
      return allowedAppIds;
    }

    try {
      const apps = Array.isArray(preloadedApps) && preloadedApps.length > 0
        ? preloadedApps
        : await findByIdsLean(AppsModel, uniqueAppIds);
      if (!apps || apps.length === 0) {
        return allowedAppIds;
      }

      const members = await findUserTeamMembers(userInfo);
      const [permissions, groupIdSet, orgIdSet] = await Promise.all([
        findPermissionsForApps(apps),
        findUserGroupIdSet(members),
        findUserOrgIdSet(members, userInfo)
      ]);
      const permissionsByResourceId = indexPermissionsByResourceId(permissions);

      for (const app of apps) {
        const appPermissions = getIndexedPermissions(permissionsByResourceId, [app?._id]);
        const result = resolvePermissionFromLoadedContext(app, userInfo, members, appPermissions, groupIdSet, orgIdSet);
        if (result.allowed) {
          allowedAppIds.add(toIdString(app._id));
        }
      }
    } catch (error) {
      return new Set();
    }

    return allowedAppIds;
  }

  /**
   * 批量筛选当前用户可读取、使用的 FastGPT 应用 ID。
   * 输入: FastGPT 应用 ID 数组和登录态用户信息。
   * 输出: 具备读权限的应用 ID Set；任一权限查询异常时 fail closed。
   */
  async function getUsableAppIds(appIds = [], userInfo = {}, preloadedApps = null) {
    const allowedAppIds = new Set();
    const uniqueAppIds = [...new Set((appIds || []).map(toIdString).filter(Boolean))];
    if (uniqueAppIds.length === 0) {
      return allowedAppIds;
    }

    try {
      const apps = Array.isArray(preloadedApps) && preloadedApps.length > 0
        ? preloadedApps
        : await findByIdsLean(AppsModel, uniqueAppIds);
      if (!apps || apps.length === 0) {
        return allowedAppIds;
      }

      const members = await findUserTeamMembers(userInfo);
      if (!members || members.length === 0) {
        return allowedAppIds;
      }

      const [permissions, groupIdSet, orgIdSet] = await Promise.all([
        findUsePermissionsForApps(apps),
        findUserGroupIdSet(members),
        findUserOrgIdSet(members, userInfo)
      ]);
      const permissionsByResourceId = indexPermissionsByResourceId(permissions);

      for (const app of apps) {
        const appPermissions = getIndexedPermissions(
          permissionsByResourceId,
          getUsePermissionResourceIds(app)
        );
        const result = resolveUsePermissionFromLoadedContext(
          app,
          userInfo,
          members,
          appPermissions,
          groupIdSet,
          orgIdSet
        );
        if (result.allowed) {
          allowedAppIds.add(toIdString(app._id));
        }
      }
    } catch (error) {
      return new Set();
    }

    return allowedAppIds;
  }

  return {
    findUserTeamMembers,
    canConfigureWecomBot,
    canUseFastgptApp,
    getConfigurableAppIds,
    getUsableAppIds
  };
}

module.exports = {
  ADMIN_BADGES,
  FASTGPT_MANAGE_ROLE_VALUE,
  FASTGPT_READ_ROLE_VALUE,
  FASTGPT_WRITE_ROLE_VALUE,
  FASTGPT_OWNER_ROLE_VALUE,
  createFastgptAppPermissionService,
  isAdminOverride
};
