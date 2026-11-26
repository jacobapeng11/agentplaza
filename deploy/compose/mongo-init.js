const password = process.env.MONGO_APP_PASSWORD;
if (!password) {
  throw new Error('MONGO_APP_PASSWORD must be configured');
}

db.getSiblingDB('agentplaza').createUser({
  user: 'agentplaza',
  pwd: password,
  roles: [{ role: 'readWrite', db: 'agentplaza' }]
});
