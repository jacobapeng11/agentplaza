// Polyfill for crypto.getRandomValues in Node.js < 17
// This must be loaded before Vite starts
const nodeCrypto = require('crypto');

// Support both global and globalThis
const globalObj = typeof globalThis !== 'undefined' ? globalThis : global;

// Force override crypto.getRandomValues
if (!globalObj.crypto) {
  globalObj.crypto = {};
}

// Use Object.defineProperty to ensure it's set properly
Object.defineProperty(globalObj.crypto, 'getRandomValues', {
  value: function (buffer) {
    return nodeCrypto.randomFillSync(buffer);
  },
  writable: true,
  configurable: true,
  enumerable: true
});

// Also set on global object explicitly for older Node.js versions
if (typeof global !== 'undefined' && global !== globalObj) {
  if (!global.crypto) {
    global.crypto = {};
  }
  Object.defineProperty(global.crypto, 'getRandomValues', {
    value: function (buffer) {
      return nodeCrypto.randomFillSync(buffer);
    },
    writable: true,
    configurable: true,
    enumerable: true
  });
}

console.log('[Polyfill] crypto.getRandomValues has been polyfilled');
