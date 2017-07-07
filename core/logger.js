const service = {
    debug: false,

    log: function(message, ...args) {
        if(service.debug) {
            console.log('[ACR1222L]' + message, ...args)
        }
    }
};

module.exports = service;