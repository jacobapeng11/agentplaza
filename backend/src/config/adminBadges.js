function resolveAdminBadges(env = process.env) {
  return (env.ADMIN_BADGES || '').split(',').map(badge => badge.trim()).filter(Boolean);
}

module.exports = { resolveAdminBadges };
