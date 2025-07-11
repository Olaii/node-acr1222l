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

  // 6.14.4 LCD Display (Graphic Mode)
  getImageCmd: async function (imagePath) {
    // Validate image path and type
    if (!imagePath) throw new Error('Image path is required');
    if (imagePath.substr(-4, 4) != ".png") throw new Error('Image must be a PNG file');

    const fs = require('fs');
    const { PNG } = require('pngjs');
    const data = fs.readFileSync(imagePath);
    const png = PNG.sync.read(data);
    // Validate PNG dimensions
    if (png.width != 128) throw new Error('Image width must be 128 pixels');
    if (png.height != 32) throw new Error('Image height must be 32 pixels');
    
    // Convert PNG data to a 2D array
    const pixels = [];
    for (let i = 0; i < png.height; i++) {
      const line = [];
      for (let j = 0; j < png.width; j++) {
        const idx = (png.width * i + j) << 2;
        let byte = 0;
        const pixel = {
          r: png.data[idx],
          g: png.data[idx + 1],
          b: png.data[idx + 2],
          a: png.data[idx + 3],
        };
        if (pixel.a > 126) { // checking transparency
          const grayscale = parseInt(0.2126 * pixel.r + 0.7152 * pixel.g + 0.0722 * pixel.b);
          if (grayscale < 128) { // checking color
            byte = 1;
          }
        }
        line.push(byte);
      }
      pixels.push(line);
    }

    const resultSections = [];
    const sectionRows = 16;
    const sectionCols = 16;
    const numCols = 128;
    const numRows = 32;

    // Iterate through the original matrix to define the top-left corner of each new section
    // 'r' represents the starting row index for the current section
    for (let r = 0; r < numRows; r += sectionRows) {
      // 'c' represents the starting column index for the current section
      for (let c = 0; c < numCols; c += sectionCols) {
        const currentSection = []; // This will hold the 2D array for the current section

        // Populate the current section by slicing rows from the original matrix
        // 'i' iterates through the rows within the current section (from 0 to sectionRows - 1)
        for (let i = 0; i < sectionRows; i++) {
          // Check to ensure we don't go out of bounds if the matrix dimensions
          // are not perfectly divisible by sectionRows.
          if (r + i < numRows) {
            // Get the row from the original matrix
            const originalRow = pixels[r + i];
            // Slice the relevant columns for the current section from this row
            // The slice goes from 'c' (start column) up to 'c + sectionCols' (exclusive end column)
            const rowSlice = originalRow.slice(c, c + sectionCols);
            currentSection.push(rowSlice);
          }
        }
        // Add the fully constructed current section to our results
        resultSections.push(currentSection);
      }
    }

    // Convert section to buffer commands
    const buffers = [];
    for (const sectionIndex in resultSections) {
      const section = resultSections[sectionIndex];

      const rowBuffer = [];
      for (const rowIndex in section) {
        const sectionRow = section[rowIndex];
        // Split each row into two bytes
        // Each row is 16 bits, so we take the first 8 bits for high and the next 8 bits for low byte
        const highByte = parseInt(sectionRow.slice(0, 8).join(''), 2);
        const lowByte = parseInt(sectionRow.slice(8, 16).join(''), 2);
        rowBuffer.push(highByte, lowByte);
      }

      // Position of second row is 0x40, first row is 0x00
      let position = parseInt(sectionIndex);
      if (position > 7) {
        position = 0x40 + (position - 8); // 0x40 is the second row
      }

      // Create buffer for the command
      // 6.14.4 LCD Display (Graphic Mode) in the ACR1222L Application Programming Interface V2.01
      const buffer = Buffer.concat([
        Buffer.from([0xFF, 0x00, 0x6A, position, 0x20]),
        Buffer.from(rowBuffer)
      ]);
      buffers.push(buffer);
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
