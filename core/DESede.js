const crypto = require('crypto');

const service = {
  KEYS: null,
  IV: null,

  init: function (keys) {
    service.KEYS = Buffer.from(keys);
    service.IV = Buffer.alloc(8, 0x0);
  },

  encrypt: function (message) {
    const cipher = crypto.createCipheriv('des-ede3-cbc', service.KEYS, service.IV);
    cipher.setAutoPadding(false);
    const cipherText = cipher.update(message);
    cipher.final();

    service.IV = cipherText.slice(cipherText.length - 8, cipherText.length);

    return cipherText;
  },

  decrypt: function (cipherText) {
    const decipher = crypto.createDecipheriv('des-ede3-cbc', service.KEYS, service.IV);
    decipher.setAutoPadding(false);
    const message = decipher.update(cipherText);
    decipher.final();

    service.IV = cipherText.slice(cipherText.length - 8, cipherText.length);

    return message;
  }
};

module.exports = service;
