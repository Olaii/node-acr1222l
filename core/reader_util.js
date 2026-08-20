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

  // LCD geometry (128x32, 1bpp)
  LCD_WIDTH: 128,
  LCD_HEIGHT: 32,
  LCD_BYTES_PER_LINE: 16,   // 128 px / 8
  LCD_MAX_LINES_PER_CMD: 8, // 8 lines * 16 bytes = 128 bytes = 0x80 (max Lc)

  // Pack a 128x32 image (PNG path or a decoded {width,height,data:RGBA} object)
  // into a line-major, 1-bit framebuffer (HEIGHT * 16 = 512 bytes). Byte 0 of a
  // line holds x=0..7 (bit 7 = x=0); a pixel is "lit" (bit = 1) when opaque and
  // dark. This is the pixel source shared by getImageCmd / getImageDiffCmd.
  buildImageFrame: function (imagePath, PNGWithMetadata) {
    const WIDTH = service.LCD_WIDTH;
    const HEIGHT = service.LCD_HEIGHT;
    const BYTES_PER_LINE = service.LCD_BYTES_PER_LINE;

    let png = null;
    if (!PNGWithMetadata) {
      const fs = require('fs');
      const { PNG } = require('pngjs');
      if (!imagePath) throw new Error('Image path is required');
      if (imagePath.substr(-4, 4) != ".png") throw new Error('Image must be a PNG file');
      png = PNG.sync.read(fs.readFileSync(imagePath));
    } else {
      png = PNGWithMetadata;
    }

    if (png.width != WIDTH) throw new Error('Image width must be 128 pixels');
    if (png.height != HEIGHT) throw new Error('Image height must be 32 pixels');

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
    return frame;
  },

  // Build one graphic-mode command (6.14.4): FF 00 6A <lineIndex> <Lc> <pixels>.
  getLCDGraphicCmd: function (lineIndex, chunk) {
    return Buffer.concat([Buffer.from([0xFF, 0x00, 0x6A, lineIndex, chunk.length]), chunk]);
  },

  // Turn a set of changed line indices into the fewest commands: consecutive
  // changed lines are coalesced, then split into runs of at most 8 lines. Each
  // graphic write costs ~1.1 ms/byte on the reader, so sending only changed
  // lines is the main lever for faster animation.
  _framebufferCmds: function (frame, changedLines) {
    const BPL = service.LCD_BYTES_PER_LINE;
    const MAX = service.LCD_MAX_LINES_PER_CMD;
    const cmds = [];
    let i = 0;
    while (i < changedLines.length) {
      const start = changedLines[i];
      let count = 1;
      // extend while lines stay consecutive and run length stays within one cmd
      while (i + count < changedLines.length &&
             changedLines[i + count] === start + count &&
             count < MAX) {
        count++;
      }
      const from = start * BPL;
      cmds.push(service.getLCDGraphicCmd(start, frame.slice(from, from + count * BPL)));
      i += count;
    }
    return cmds;
  },

  // Full redraw: every line.
  getImageCmdFromFrame: function (frame) {
    const lines = [];
    for (let y = 0; y < service.LCD_HEIGHT; y++) lines.push(y);
    return service._framebufferCmds(frame, lines);
  },

  // Incremental redraw: only lines that differ from prevFrame.
  getImageDiffCmdFromFrame: function (frame, prevFrame) {
    const BPL = service.LCD_BYTES_PER_LINE;
    const lines = [];
    for (let y = 0; y < service.LCD_HEIGHT; y++) {
      const s = y * BPL;
      if (Buffer.compare(frame.slice(s, s + BPL), prevFrame.slice(s, s + BPL)) !== 0) lines.push(y);
    }
    return service._framebufferCmds(frame, lines);
  },

  // Backwards-compatible full-image command builder.
  getImageCmd: async function (imagePath, PNGWithMetadata) {
    return service.getImageCmdFromFrame(service.buildImageFrame(imagePath, PNGWithMetadata));
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
