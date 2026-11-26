const { readWecomBotConfig } = require('./wecomBot');

function readIntegrationConfig(env = process.env) {
  return {
    McpEnabled: Boolean(
      env.HIGRESS_CONSOLE_BASE_URL?.trim()
      && (env.MCP_GATEWAY_BASE_URL?.trim() || env.HIGRESS_GATEWAY_BASE_URL?.trim())
    ),
    WecomBotEnabled: readWecomBotConfig(env).enabled,
    SkillEnabled: env.SKILL_ENABLED === 'true'
  };
}

module.exports = { readIntegrationConfig };
