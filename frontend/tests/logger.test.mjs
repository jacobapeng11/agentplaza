import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

/**
 * 编译 TypeScript 源码为可在 VM 中运行的 CommonJS。
 * 输入: 源码文件 URL 和可选 Vite env。
 * 输出: CommonJS JavaScript 源码。
 */
function transpileModule(fileUrl, viteEnv = {}) {
  const source = readFileSync(fileUrl, 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    }
  }).outputText.replaceAll('import.meta', `({ env: ${JSON.stringify(viteEnv)} })`);
}

/**
 * 加载前端 logger 模块并注入运行时配置和 console。
 * 输入: runtimeConfig、Vite env 和 console 桩。
 * 输出: logger.ts 导出的成员。
 */
function loadLoggerModule({ runtimeConfig = {}, viteEnv = {}, consoleRef = console } = {}) {
  const runtimeExports = {};
  const runtimeContext = {
    exports: runtimeExports,
    module: { exports: runtimeExports },
    window: { __APP_CONFIG__: runtimeConfig },
    __APP_CONFIG__: runtimeConfig
  };
  vm.runInNewContext(
    transpileModule(new URL('../src/config/runtimeConfig.ts', import.meta.url), viteEnv),
    runtimeContext
  );

  const loggerModule = { exports: {} };
  const loggerContext = {
    exports: loggerModule.exports,
    module: loggerModule,
    console: consoleRef,
    window: { __APP_CONFIG__: runtimeConfig },
    __APP_CONFIG__: runtimeConfig,
    require: (specifier) => {
      if (specifier === '../config/runtimeConfig') {
        return runtimeContext.module.exports;
      }
      throw new Error(`Unexpected require: ${specifier}`);
    }
  };

  vm.runInNewContext(
    transpileModule(new URL('../src/utils/logger.ts', import.meta.url), viteEnv),
    loggerContext
  );
  return loggerModule.exports;
}

/**
 * 创建记录调用参数的 console 桩。
 * 输入: 无。
 * 输出: 按级别保存调用记录的对象。
 */
function createConsoleCollector() {
  const calls = {
    debug: [],
    info: [],
    warn: [],
    error: []
  };
  return {
    calls,
    consoleRef: {
      debug: (...args) => calls.debug.push(args),
      info: (...args) => calls.info.push(args),
      warn: (...args) => calls.warn.push(args),
      error: (...args) => calls.error.push(args)
    }
  };
}

test('runtime LOG_LEVEL filters frontend logs using backend-compatible levels', () => {
  const collector = createConsoleCollector();
  const { logger } = loadLoggerModule({
    runtimeConfig: { LOG_LEVEL: 'error' },
    consoleRef: collector.consoleRef
  });

  logger.debug('hidden debug');
  logger.info('hidden info');
  logger.warn('hidden warn');
  logger.error('visible error');

  assert.equal(collector.calls.debug.length, 0);
  assert.equal(collector.calls.info.length, 0);
  assert.equal(collector.calls.warn.length, 0);
  assert.equal(collector.calls.error.length, 1);
});

test('frontend logger redacts sensitive nested payload fields', () => {
  const collector = createConsoleCollector();
  const { logger } = loadLoggerModule({
    runtimeConfig: { LOG_LEVEL: 'debug' },
    consoleRef: collector.consoleRef
  });

  logger.debug('payload', {
    token: 'token-value',
    nested: {
      apiKey: 'api-key-value',
      safe: 'visible'
    }
  });

  const serialized = JSON.stringify(collector.calls.debug);
  assert.match(serialized, /\[REDACTED\]/);
  assert.match(serialized, /visible/);
  assert.doesNotMatch(serialized, /token-value/);
  assert.doesNotMatch(serialized, /api-key-value/);
});
