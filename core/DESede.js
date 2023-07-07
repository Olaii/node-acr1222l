const crypto = require('crypto');
const logger = require('./logger');

const service = {
  KEYS: null,
  IV: null,

  init: function (keys) {
    service.KEYS = Buffer.from(keys);
    service.IV = Buffer.alloc(8, 0x0);
  },

  encrypt: function (message) {
    let cipher = crypto.createCipheriv('des-ede3-cbc', service.KEYS, service.IV);
    cipher.setAutoPadding(false);
    let cipherText = cipher.update(message);
    cipher.final();

    service.IV = cipherText.slice(cipherText.length - 8, cipherText.length);

    return cipherText;
  },

  decrypt: function (cipherText) {
    let decipher = crypto.createDecipheriv('des-ede3-cbc', service.KEYS, service.IV);
    decipher.setAutoPadding(false);
    let message = decipher.update(cipherText);
    decipher.final();

    service.IV = cipherText.slice(cipherText.length - 8, cipherText.length);

    return message;
  },

};

module.exports = service;
