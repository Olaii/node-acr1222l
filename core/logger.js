const service = {
  debug: false,

  log: function (message, ...args) {
    if (service.debug) console.log('[ACR1222L] ' + message, ...args)
  },

  error: function (message, ...args) {
    if (service.debug) console.error('[ACR1222L] ' + message, ...args)
  },

  info: function (message, ...args) {
    if (service.debug) console.info('[ACR1222L] ' + message, ...args)
  },

  warning: function (message, ...args) {
    if (service.debug) console.warn('[ACR1222L] ' + message, ...args)
  }
};

module.exports = service;