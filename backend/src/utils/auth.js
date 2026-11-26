const { getUserSession, storeUserSession } = require('./redis');

async function createAuthTokenAndStore({ name, accessToken, userInfo }) {
  const stored = await storeUserSession(accessToken, { name, userInfo });
  return stored ? accessToken : null;
}

async function getUserInfoFromToken(authHeader) {
  if (typeof authHeader !== 'string') return null;
  const token = authHeader.replace(/^Bearer /i, '');
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await getUserSession(token);
  if (!session?.name) return null;

  const badge = session.name;
  const profile = session.userInfo || {};
  return {
    _id: badge,
    name: badge,
    userId: badge,
    employeeNumber: badge,
    Name: profile.Name || badge,
    Badge: badge,
    DepartmentCode: profile.DepartmentCode || '',
    teamId: profile.teamId || 'default'
  };
}

async function verifyToken(req, res, next) {
  const user = await getUserInfoFromToken(req.headers.authorization);
  if (!user) {
    return res.status(401).json({ success: false, message: '缺少认证令牌或令牌无效' });
  }
  req.user = {
    _id: user.userId,
    tmbId: user.userId,
    name: user.name,
    employeeNumber: user.employeeNumber
  };
  return next();
}

module.exports = { createAuthTokenAndStore, getUserInfoFromToken, verifyToken };
