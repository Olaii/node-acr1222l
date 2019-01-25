const crypto = require('crypto');

const service = {
    KEYS: null,
    IV: null,

    init: function(keys){
      service.KEYS = keys;
      service.IV = [0,0,0,0,0,0,0,0];
    },

    encrypt: function(message){
        let cipher = crypto.createCipheriv('des-ede3-cbc', service.KEYS, service.IV);
        cipher.update(message);
        let cipherText = cipher.final();

        service.IV = cipherText.slice(cipherText.length-8, cipherText.length);

        return cipherText;
    },

    decrypt: function(cipherText){
      let decipher = crypto.createDecipheriv('des-ede3-cbc', service.KEYS, service.IV);
      decipher.update(cipherText);

      service.IV = cipherText.slice(cipherText.length-8, cipherText.length);

      return decipher.final();
    },

};

module.exports = service;
