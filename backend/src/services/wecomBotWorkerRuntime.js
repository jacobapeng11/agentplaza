const { readWecomBotConfig } = require('../config/wecomBot');
const { createWecomBotWorkerScheduler } = require('./wecomBotWorkerScheduler');

let sharedScheduler = null;
let sharedConfig = null;

/**
 * 获取进程内共享的企业微信 Bot Worker 调度器。
 * 输入: 可选运行配置和调度器工厂。
 * 输出: 同一 Node 进程内复用的 scheduler 实例，确保 bootstrap 与 API 启停共享内存 Worker 注册表。
 */
function getWecomBotWorkerScheduler({
  config = null,
  schedulerFactory = createWecomBotWorkerScheduler
} = {}) {
  if (!sharedScheduler) {
    sharedConfig = config || readWecomBotConfig();
    sharedScheduler = schedulerFactory({ config: sharedConfig });
  }

  return sharedScheduler;
}

/**
 * 重置企业微信 Bot Worker 运行时单例。
 * 输入: 无。
 * 输出: 清空已缓存的 scheduler/config；仅供测试隔离或显式重装配使用。
 */
function resetWecomBotWorkerRuntime() {
  sharedScheduler = null;
  sharedConfig = null;
}

module.exports = {
  getWecomBotWorkerScheduler,
  resetWecomBotWorkerRuntime
};
