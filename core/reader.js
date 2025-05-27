let pcsc = require('@pokusew/pcsclite');
const reader_util = require('./reader_util');
const logger = require('./logger');
const des = require('./DESede');
const AppError = require('./exceptions');


const service = {
  initialized: false,
  reader: null,
  pcsc_instance: null,
  connectionProtocol: null,
  commandInProgress: false,
  cardPresent: false,
  waitingRequests: {},
  callback: function () { },

  /**
   * Initialize PCSC instance
   * 
   * @param {string} error_callback - callback function for pcsc instance errors
   * @param {boolean} debug - display debug messages
   * @return {promise}
   */
  initialize: async function (error_callback, debug = false) {
    return new Promise(function (resolve, reject) {
      logger.debug = debug;
      if (service.initialized) return resolve();
      service.initialized = true;
      service.pcsc_instance = pcsc();

      // Watch for PCSC errors
      service.pcsc_instance.on('error', function (err) {
        logger.log('PCSC Error occurred:', err);
        error_callback({ error: err, error_code: 'PCSC_ERROR' });
      });

      // Watch for PCSC reader messages
      service.pcsc_instance.on('reader', function (reader) {
        if (!reader_util.isValidReader(reader)) {
          // Close all other invalid readers
          return reader.close();
        }

        // Status handler
        reader.on('status', function (status) {
          service.handleStatusChange(status);
        });

        // Reader removed handler
        reader.on('end', async function () {
          logger.log('Reader removed - reader end');
          service.callback({ id: "READER_END", name: "Reader was disconnected" });

          service.reader = null;
          service.cardPresent = false;
          service.commandInProgress = false;
          reader.close();

          error_callback({ error: new Error('Reader removed'), error_code: 'READER_REMOVED' })
          service.closePCSC();
          await service.initialize(error_callback, debug);
        });

        // Reader error handler
        reader.on('error', function (err) {
          logger.log('Reader error occurred:', err);

          // service.reader = null;
          service.cardPresent = false;
          service.commandInProgress = false;
          // reader.close();

          error_callback({ error: err, error_code: 'READER_ERROR' });
        });

        logger.log('Reader found:', reader.name);
        service.callback({ id: "READER_FOUND", name: "Reader was connected", data: reader });
        service.reader = reader;
      });

      // Resolve init at this point
      logger.log('Init completed');
      return resolve();
    });
  },


  /**
  * Is the NFC Reader present
  * @return {boolean}
  */
  hasReader: function () {
    return service.reader ? true : false;
  },


  /**
  * Stop the PCSC service, clear resources and set as uninitialized.
  * @return {void}
  */
  closePCSC: function () {
    service.pcsc_instance.close();
    service.initialized = false;
    service.reader = null;
    service.pcsc_instance = null;
    service.connectionProtocol = null;
    service.cardPresent = false;
    reader_util.rejectWaitingRequestsCallbacks(service.waitingRequests);
    service.waitingRequests = {};
    service.commandInProgress = false;
  },


  /**
  * Handle reader status change
  * @return {void}
  */
  handleStatusChange: async function (status) {
    const changes = service.reader.state ^ status.state;

    if (service.reader.state && (changes & service.reader.SCARD_STATE_EMPTY) && (status.state & service.reader.SCARD_STATE_EMPTY)) {
      logger.log('Card removed');
      service.cardPresent = false;
      await service._disconnect();
    } else if ((changes & service.reader.SCARD_STATE_PRESENT) && (status.state & service.reader.SCARD_STATE_PRESENT)) {
      logger.log('Card present');
      service.cardPresent = true;
      try {
        if (!service.commandInProgress) {
          await service._connect(reader_util.CONN_MODE(service.reader), reader_util.CARD_PROTOCOL);
          reader_util.performCardPresentCallbacks(service.waitingRequests);
        } else {
          logger.log("There is already LCD command in progress. Cannot connect to card.")
        }
      } catch (err) {
        logger.log("Card present ERROR CONNECTING", err)
      }
    }
  },


  /**
  * Connect to reader with share mode and protocol
  */
  _connect: async function (share_mode, protocol) {
    logger.log('Connect requested with SHARE_MODE=' + share_mode + ' and PROTOCOL=' + protocol);
    if (service.reader.connected) return service.connectionProtocol;

    return new Promise(function (resolve, reject) {
      service.reader.connect({ share_mode: share_mode, protocol: protocol }, function (err, protocol) {
        if (err) {
          logger.log('Error connecting with reader:', err);
          return reject(err);
        }
        logger.log('Connected with protocol:', protocol);
        service.connectionProtocol = protocol;
        resolve(protocol);
      });
    });
  },


  /**
  * Disconnect from reader
  */
  _disconnect: async function () {
    if (!service.reader.connected) {
      logger.log('Reader was not connected');
      return true;
    }

    return new Promise(function (resolve, reject) {
      service.reader.disconnect(service.reader.SCARD_LEAVE_CARD, function (err) {
        if (err) {
          logger.log('Error disconnecting:', err.message);
          return reject(err);
        }
        logger.log('Disconnected');
        // Clean variables
        service.connectionProtocol = null;
        resolve(true);
      });
    });
  },


  /**
  * Transmit control command
  */
  transmitControl: async function (cmd) {
    return new Promise(function (resolve, reject) {
      if (!service.reader) return reject(new Error("Reader not connected"));
      service.reader.control(cmd, service.reader.SCARD_CTL_CODE(3500), 40, function (err, data) {
        if (err) return reject(err);
        resolve(data);
      });
    });
  },


  /**
  * Transmit command
  */
  transmit: async function (cmd) {
    return new Promise(function (resolve, reject) {
      if (!service.reader) return reject(new Error("Reader not connected"));
      service.reader.transmit(cmd, 1024, service.connectionProtocol, function (err, data) {
        if (err) return reject(err);
        resolve(data);
      });
    });
  },


  /**
  * Wrap commands with connection fallbacks
  */
  _wrapCommands: async function (cmds) {
    if (service.commandInProgress) {
      logger.log("Command in progress. Ignoring")
      return false;
    }

    service.commandInProgress = true;
    let needsDisconnect = false;

    // wrapped in try catch to prevent reader in stuck state
    try {
      if (service.reader && !service.reader.connected) {
        await service._connect(service.reader.SCARD_SHARE_DIRECT, reader_util.CTRL_PROTOCOL);
        needsDisconnect = true;
      }
    }catch (err) {
      service.commandInProgress = false
      throw err
    }

    try {
      for (let i = 0; i < cmds.length; i++) {
        await service.transmitControl(cmds[i]);
      }
    } catch (err) {
      logger.log("Error while transmitting command", err)
      service.commandInProgress = false;
      throw err;
    }

    try {
      if (needsDisconnect) await service._disconnect();
    } catch (err) {
      logger.log("Error disconnecting from reader - _wrapCommands", err);
    }

    service.commandInProgress = false;

    return true;
  },


  /**
  * Turns on reader screen backlight
  */
  turnOnBacklight: async function () {
    logger.log('Turn on backlight');
    return await service._wrapCommands([reader_util.CMD_BACKLIGHT_ON]);
  },


  /**
  * Turns off reader screen backlight
  */
  turnOffBacklight: async function () {
    logger.log('Turn off backlight');
    return await service._wrapCommands([reader_util.CMD_BACKLIGHT_OFF]);
  },


  /**
  * Write to reader screen
  * @param {string} row1 - Text for row 1
  * @param {string} row2 - Text for row 2
  */
  writeToLCD: async function (row1 = '', row2 = '') {
    logger.log('Write to LCD:', row1, row2);
    return await service._wrapCommands([
      reader_util.CMD_BACKLIGHT_ON,
      reader_util.getLCDTextCmd(row1, 1),
      reader_util.getLCDTextCmd(row2, 2)
    ]);
  },


  /**
  * Clear reader screen
  */
  clearLCD: async function () {
    logger.log('Clear LCD');
    return await service._wrapCommands([
      reader_util.CMD_BACKLIGHT_OFF,
      reader_util.getLCDTextCmd(' ', 1),
      reader_util.getLCDTextCmd(' ', 2)
    ]);
  },


  /**
  * Write buffer to address
  * @param {Buffer} buffer - Buffer data to write on card
  * @param {string} addr - Address on card
  */
  writeBuffer: async function (buffer, addr) {
    logger.log('Write Buffer requested. Buffer:', buffer);

    if (!service.cardPresent) {
      return new Promise(function (resolve, reject) {
        // Wait for the card to be attached
        service.waitingRequests.writeBufferRequest = {
          resolve,
          reject,
          func: service.writeBuffer,
          params: [buffer, addr]
        }
      });
    }

    const response = await service.transmit(reader_util.CMD_WRITE(buffer, addr));

    if (response[0] === 0x90) {
      logger.log('Write successful');
    } else if (response[0] === 0xfe) {
      logger.log('Write failed. Card is locked!');
      throw new AppError('Write failed. Card is locked!', status = 'CARD_LOCKED');
    } else {
      logger.log('Write failed with error code:', response[0]);
      throw new AppError('Write failed with Error code: ' + response[0], 'WRITE_FAILED');
    }

    return true;
  },


  /**
  * Stop write buffer
  */
  stopWriteBuffer: async function () {
    logger.log('Stop write buffer');
    delete service.waitingRequests.writeBufferRequest;
    return true;
  },


  /**
  * Read UUID on card
  */
  readUUID: async function () {
    logger.log('Read UUID requested.');

    if (!service.cardPresent) {
      return new Promise(function (resolve, reject) {
        // Wait for the card to be attached
        service.waitingRequests.readUUIDRequest = { resolve: resolve, reject: reject, func: service.readUUID, params: [] }
      });
    }

    let uuid = await service.transmit(reader_util.CMD_READ_UUID);
    uuid = uuid.slice(0, -2);
    logger.log('Card UUID read:', uuid);

    return uuid;
  },


  /**
  * Stop read UUID
  */
  stopReadUUID: async function () {
    logger.log('Stop UUID read');
    delete service.waitingRequests.readUUIDRequest;
    return true;
  },


  /**
  * Read bytes on address
  * @param {string} addr - Address on card
  * @param {number} num_bytes - Number of bytes to read
  * @param {boolean} wait_for_card - Wait for card and then read
  */
  readBytes: async function (addr, num_bytes = 4, wait_for_card = false) {
    logger.log('Read ' + num_bytes + ' on addr:', addr);

    if (!service.cardPresent && wait_for_card) {
      return new Promise(function (resolve, reject) {
        // Wait for the card to be attached
        service.waitingRequests.readBytesRequest = { resolve: resolve, reject: reject, func: service.readBytes, params: [addr, num_bytes] }
      });
    } else if (!service.cardPresent && wait_for_card === false) {
      throw new AppError('Card not present!', 'CARD_NOT_PRESENT')
    }

    const response = Buffer.from(await service.transmit(reader_util.CMD_READ_BYTES(addr, num_bytes)));

    if (response.slice(-2, -1)[0] === 0x90) {
      logger.log('Read bytes successful');
    } else {
      throw new AppError('Read bytes failed!', 'READ_FAILED')
    }

    return response.slice(0, -2);
  },


  /**
  * Stop reading bytes
  */
  stopReadBytes: function () {
    logger.log('Stop read bytes');
    delete service.waitingRequests.readBytesRequest;
    return true;
  },


  /**
  * Authenticate with password
  * @param {string} pwd - Password
  */
  authenticate: async function (pwd) {
    return await authenticateNTAG(pwd);
  },


  /**
  * Authenticate NTAG with password
  * @param {string} pwd - Password
  */
  authenticateNTAG: async function (pwd) {
    logger.log('Authenticated NTAG called');

    if (!service.cardPresent) {
      throw new AppError('Cant authenticate as the card is not present', 'CARD_NOT_PRESENT');
    }

    const pack = await service.transmit(reader_util.wrapCmd(0x1b, pwd));

    if (pack[2] === 0x00) {
      logger.log('Authentication successful. PACK:', pack.slice(3, 5));
    } else {
      logger.log('Wrong PWD. Authentication failed!');
      throw new AppError('Wrong password. Authentication failed!', 'WRONG_PASSWORD');
    }

    return pack.slice(3, 5);
  },


  /**
  * Authenticate UltralightC with keys
  */
  authenticateUltralightC: async function (keys) {
    logger.log('Authenticated UltralightC called');

    if (!service.cardPresent) {
      throw new AppError('Cant authenticate as the card is not present', status = 'CARD_NOT_PRESENT');
    }

    des.init(keys);

    let rndA = Buffer.alloc(8);
    for (let i = 0; i < rndA.length; i++) {
      rndA[i] = Math.floor(Math.random() * 256);
    }

    let hcRndB = await service.transmit(reader_util.wrapCmd(0x1A, Buffer.alloc(1)));
    let rndB = des.decrypt(hcRndB.slice(4, -2));
    let rndBr = service._rotateLeft(rndB);

    let rndArndBr = Buffer.concat([rndA, rndBr])
    let cRndArndBr = des.encrypt(rndArndBr);

    let hcRndAr = await service.transmit(reader_util.wrapCmd(0xAF, cRndArndBr));
    let rndAr = des.decrypt(hcRndAr.slice(4, -2));
    let rndA2 = service._rotateRight(rndAr);

    if (Buffer.compare(rndA, rndA2) != 0) {
      logger.log('Wrong PWD. Authentication failed!');
      throw new AppError('Wrong password. Authentication failed!', status = 'WRONG_PASSWORD');
    }

    return;
  },


  /**
  * Read NDEF data
  */
  readNDEF: async function (addr_start = 0x04, addr_end = 0x27) {
    if (!service.cardPresent) {
      return new Promise(function (resolve, reject) {
        // Wait for the card to be attached
        service.waitingRequests.readNDEFRequest = { resolve: resolve, reject: reject, func: service.readNDEF, params: [addr_start, addr_end] }
      });
    }

    try {
      let data = null;
      try {
        data = await service.fastRead(addr_start, addr_end);
      } catch (err) {
        logger.log('Fast read command failed. Retrying with READ command');
        await service.transmit(Buffer.from([0xD4, 0x54, 0x01])); // WUPA

        data = Buffer.alloc(0);
        let addr = addr_start;
        for (; addr <= addr_end; addr++) {
          let read = await service.readBytes(addr, 4, false);
          data = Buffer.concat([data, read]);
        }
      }

      const response = await reader_util.getNDEFData(data);
      response.uuid_bytes = await service.readUUID();
      response.uuid = response.uuid_bytes.toString('hex').toUpperCase();

      return response;
    } catch (err) {
      logger.log('Error during read NDEF. Please present the card to the reader');
      return new Promise(function (resolve, reject) {
        // Wait for the card to be attached
        service.waitingRequests.readNDEFRequest = { resolve: resolve, reject: reject, func: service.readNDEF, params: [addr_start, addr_end] }
      });
    }
  },


  /**
  * Stop NDEF read
  */
  stopNDEFRead: function () {
    logger.log('Stop NDEF read');
    delete service.waitingRequests.readNDEFRequest;
    return true;
  },


  /**
  * Fast read
  */
  fastRead: async function (addr_start = 0x04, addr_end = 0x27) {
    logger.log('Fast read requested from page: ' + addr_start + ' to page: ' + addr_end);

    const response = await service.transmit(reader_util.wrapCmd(0x3A, Buffer.from([addr_start, addr_end])));

    if (response[2] === 0x00) {
      response = response.slice(3, -2);
    } else {
      throw new AppError('Fast read command failed.', 'FAST_READ_FAILED')
    }

    return response;
  },


  /**
  * Get version
  */
  getVersion: async function () {
    logger.log('Get version requested');

    let response = await service.transmit(reader_util.wrapCmd(0x60, Buffer.alloc(0)));

    if (response[2] === 0x00) {
      response = response.slice(3, -2);
    } else {
      throw new AppError('Get version command failed.', 'GET_VERSION_FAILED')
    }

    return response;
  },


  /**
  *  Rotate array left
  */
  _rotateLeft: function (array) {
    let ret = Buffer.from(array);
    for (let i = 1; i < array.length; i++) {
      ret[i - 1] = ret[i];
    }
    ret[ret.length - 1] = array[0];
    return ret;
  },


  /**
  *  Rotate array right
  */
  _rotateRight: function (array) {
    let ret = Buffer.from(array);
    for (let i = array.length - 2; i >= 0; i--) {
      ret[i + 1] = ret[i];
    }
    ret[0] = array[ret.length - 1];
    return ret;
  },
};


module.exports = service;
