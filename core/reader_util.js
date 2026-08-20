const ndef = require('ndef');
const isWin = /^win/.test(process.platform);
const isOsx = /^darwin/.test(process.platform);


const service = {
  // Define correct CTRL_PROTOCOL to be used when establishing a connection
  CTRL_PROTOCOL: (isWin ? 0 : 4),  // 0 for Windows, 4 for macOS and Linux
  CARD_PROTOCOL: 3,  // T1 or T0 - card will decide.
  CONN_MODE: function (reader) {
    return reader.SCARD_SHARE_SHARED
  },
  // Reader Commands
  // Card reactivation ("WUPA"). Wakes a card that dropped to HALT after a NAK
  // (e.g. reading a password-protected config page) so the next command, such
  // as PWD_AUTH, can run. The two OSes drive this reader through different
  // driver stacks and need different framings — verified working per-OS:
  //   Windows: bare PN532 InSelect frame        (ACS driver forwards it as-is)
  //   macOS  : ACR-escaped InListPassiveTarget   (strict CCID stack; re-poll)
  CMD_REACTIVATE: isWin
    ? Buffer.from([0xD4, 0x54, 0x01])
    : Buffer.from([0xFF, 0x00, 0x00, 0x00, 0x04, 0xD4, 0x4A, 0x01, 0x00]),
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


  // 6.14.2 LCD Display (ASCII Mode)
  getLCDTextCmd: function (text, row_num = 1) {
    text = text + ' '.repeat(Math.max(16 - text.length, 0)); // fill in to be of length 16
    const txt = Buffer.from(text);
    const len = Buffer.from([text.length]);
    const row_cmd = row_num === 1 ? 0x00 : 0x40;
    return Buffer.concat([Buffer.from([0xFF, 0x00, 0x68, row_cmd]), len, txt]);
  },

  // 6.14.1 Clear LCD
  getLCDClearCmd: function () {
    return Buffer.from([0xFF, 0x00, 0x60, 0x00, 0x00]);
  },

  // 6.14.7 LCD Contrast Control
  getLCDContrastControlCmd: function (contrast = 0) {
    if (contrast < 0 || contrast > 15) throw new Error('Contrast must be between 0 and 15');
    return Buffer.from([0xFF, 0x00, 0x6C, contrast, 0x00]);
  },

  // 6.14.4 LCD Display (Graphic Mode)
  //
  // The ACR1222L LCD (128x32) is addressed by LINE, not by 16x16 block. Each
  // "LCD Display" command is:
  //     FF 00 6A <lineIndex> <Lc> <pixel bytes...>
  // where lineIndex is 0x00..0x1F (top to bottom), each line is 16 bytes wide
  // (128 px, MSB = leftmost pixel, bit = 1 lit), and Lc (pixel data length) may
  // be up to 0x80 (128 bytes = 8 lines) per command. We pack the whole 32x128
  // frame and send it as 4 commands of 8 lines each (line 0x00, 0x08, 0x10,
  // 0x18). Verified against firmware ACR1222L-U V314.00.
  getImageCmd: async function (imagePath, PNGWithMetadata) {
    const fs = require('fs');
    const { PNG } = require('pngjs');
    let png = null;

    // Validate image path and type
    if (!PNGWithMetadata) {
      if (!imagePath) throw new Error('Image path is required');
      if (imagePath.substr(-4, 4) != ".png") throw new Error('Image must be a PNG file');
      const data = fs.readFileSync(imagePath);
      png = PNG.sync.read(data);
    } else {
      png = PNGWithMetadata;
    }

    const WIDTH = 128;
    const HEIGHT = 32;
    const BYTES_PER_LINE = WIDTH / 8; // 16

    // Validate PNG dimensions
    if (png.width != WIDTH) throw new Error('Image width must be 128 pixels');
    if (png.height != HEIGHT) throw new Error('Image height must be 32 pixels');

    // Pack the image into a line-major, 1-bit framebuffer.
    // Byte layout per line: byte 0 holds x=0..7 (bit 7 = x=0), byte 15 holds
    // x=120..127. A pixel is "lit" (bit = 1) when it is opaque and dark.
    const frame = Buffer.alloc(HEIGHT * BYTES_PER_LINE);
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const idx = (WIDTH * y + x) << 2;
        const a = png.data[idx + 3];
        if (a > 126) { // checking transparency
          const grayscale = parseInt(0.2126 * png.data[idx] + 0.7152 * png.data[idx + 1] + 0.0722 * png.data[idx + 2]);
          if (grayscale < 128) { // checking color
            frame[y * BYTES_PER_LINE + (x >> 3)] |= (0x80 >> (x & 7));
          }
        }
      }
    }

    // Split into commands of at most 8 lines (0x80 bytes of pixel data) each.
    const LINES_PER_CMD = 8;
    const buffers = [];
    for (let line = 0; line < HEIGHT; line += LINES_PER_CMD) {
      const start = line * BYTES_PER_LINE;
      const chunk = frame.slice(start, start + LINES_PER_CMD * BYTES_PER_LINE);
      buffers.push(Buffer.concat([
        Buffer.from([0xFF, 0x00, 0x6A, line, chunk.length]),
        chunk
      ]));
    }

    return buffers;
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
