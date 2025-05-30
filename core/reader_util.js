const ndef = require('ndef');
const isWin = /^win/.test(process.platform);
const isOsx = /^darwin/.test(process.platform);


const service = {
  // Define correct CTRL_PROTOCOL to be used when establishing a connection
  CTRL_PROTOCOL: (isWin ? 0 : 4),  // 0 for Windows, 4 for macOS and Linux
  CARD_PROTOCOL: 3,  // T1 or T0 - card will decide.
  CONN_MODE: function (reader) {
    return isWin ? reader.SCARD_SHARE_SHARED : reader.SCARD_SHARE_DIRECT
  },
  // Reader Commands
  CMD_BACKLIGHT_ON: Buffer.from([0xFF, 0x00, 0x64, 0xFF, 0x00]),
  CMD_BACKLIGHT_OFF: Buffer.from([0xFF, 0x00, 0x64, 0x00, 0x00]),
  CMD_READ_UUID: Buffer.from([0xFF, 0xCA, 0x00, 0x00, 0x00]),
  CMD_WRITE: function (buffer, addr) {
    return Buffer.from([0xFF, 0xD6, 0x00, addr, buffer.length, ...buffer]);
  },
  CMD_READ_BYTES: function (addr, num_bytes) {
    return Buffer.from([0xFF, 0xB0, 0x00, addr, num_bytes]);
  },

  /**
   * ACR1222L presents itself as 4 separate readers to the OS, because of the SAM
   * modules it contains.
   *
   * This function will take a look at readers name and return true or false based on
   * the OS it's running on.
   *
   * @param reader
   * @returns {boolean}
  */
  isValidReader: function (reader) {
    if (isWin) {
      return reader.name.toLowerCase().indexOf('picc 0') > -1
    } else if (isOsx) {
      return ((reader.name.toLowerCase().indexOf('picc') > -1) && (reader.name.toLowerCase().indexOf('(1)') > -1))
    } else {
      return reader.name.toLowerCase().indexOf('00 00') > -1
    }
  },


  getLCDTextCmd: function (text, row_num = 1) {
    text = text + ' '.repeat(Math.max(16 - text.length, 0)); // fill in to be of length 16
    const txt = Buffer.from(text);
    const len = Buffer.from([text.length]);
    const row_cmd = row_num === 1 ? 0x00 : 0x40;
    return Buffer.concat([Buffer.from([0xFF, 0x00, 0x68, row_cmd]), len, txt]);
  },


  performCardPresentCallbacks: function (waitingRequests) {
    for (let key in waitingRequests) {
      const callBackObj = waitingRequests[key];
      try {
        const res = callBackObj.func(...callBackObj.params);
        callBackObj.resolve(res);
      } catch (err) {
        callBackObj.reject(err)
      }
      delete waitingRequests[key];
    }
  },


  rejectWaitingRequestsCallbacks: function (waitingRequests) {
    for (let key in waitingRequests) {
      const callBackObj = waitingRequests[key];
      callBackObj.reject(new Error('Restarting PCSC'))
      delete waitingRequests[key];
    }
  },


  wrapCmd: function (cmd, dataIn) {
    /**
    {
      0xFF, // CLA
      0x00, // INS
      0x00, // P1
      0x00, // P2
      0x07, // LC // - total length with D4h and 42h
      0xD4, 0x42, // InCommunicateThru
      0x1B, // PWD_AUTH (See data sheet) - CMD here
      Password, // payload - instruction data
      Password >> 8,
      Password >> 16,
      Password >> 24,
    };
    */
    return Buffer.from([0xFF, 0x00, 0x00, 0x00, dataIn.length + 3, 0xD4, 0x42, cmd, ...dataIn]);
  },


  getNDEFData: async function (data) {
    if (data.indexOf(0x03) === -1) {
      throw new Error('Bytes do no not contain NDEF message!');
    } else {
      let end_terminator = 0xfe;
      if (data.indexOf(0xfe) === -1) {
        end_terminator = 0x00;
      }

      const indexes = []
      for (let i = 0; i < data.length; i++) {
        if (data[i] == 0x03) {
          indexes.push(i);
        }
      }

      for (let i = 0; i < indexes.length; i++) {
        const ndef_data = data.slice(indexes[i] + 2, data.indexOf(end_terminator)).toJSON();
        const record = ndef.decodeMessage(ndef_data.data)[0];

        if (record.tnf === ndef.TNF_WELL_KNOWN && record.type[0] === ndef.RTD_TEXT[0]) {
          const ndef_value = ndef.text.decodePayload(record.payload);

          return {
            original_bytes: data,
            ndef: ndef_value
          };
        }
      }
      throw new Error('Unknown NDEF message');
    }
  }
};


module.exports = service;
