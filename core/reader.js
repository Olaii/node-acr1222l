let pcsc = require('@Olaii/pcsclite');
const reader_util = require('./reader_util');
const logger = require('./logger');
const des = require('./DESede');
const AppError = require('./exceptions');


const service = {
  initialized: false,
  reader: null,            // PICC handle - contactless card I/O
  peripheralReader: null,  // dedicated handle for LCD/peripheral escape commands
  pcsc_instance: null,
  connectionProtocol: null,
  cardPresent: false,
  waitingRequests: {},
  callback: function () { },
  _lastFrame: null, // last framebuffer sent to the LCD, for incremental redraw

  // LCD graphic-mode addressing. The command layout changed with firmware:
  //   firmware 3xx -> 'line'  (API 1.04 scanline layout)
  //   firmware 4xx -> 'block' (API 2.01 16x16-block layout, 2022)
  // 'auto' reads the firmware version on the first image draw and picks; use
  // setLCDAddressing() to force it.
  lcdAddressing: 'auto',        // 'auto' | 'line' | 'block'
  _resolvedAddressing: null,    // cached result of auto-detection
  firmwareVersion: null,        // reader firmware string, once read

  // Two independent FIFO locks, one per physical handle. The ACR1222L exposes
  // the contactless card on the PICC handle and drives its LCD/LED/buzzer as
  // device-level PC_to_RDR_Escape commands (ACR1222L API v1.04 6.0, vendor
  // IOCTL 3500) which can be issued over any handle. We therefore keep a SECOND
  // handle open purely for peripheral escape commands, exactly like the SAM_0
  // approach used previously. Because the two channels live on different
  // handles they run in parallel and never corrupt each other; each lock only
  // serializes its own channel (card connect/disconnect vs transmit; LCD batch
  // vs LCD batch). This removes the "card tapped while an LCD command runs"
  // failure: the card presence events and the LCD escape sequence no longer
  // share a handle or any mutable connection state.
  //
  // _cardRun and _lcdRun are installed at the bottom of this file.
  _cardRun: null,
  _lcdRun: null,

  /**
  * Build a FIFO async lock. Tasks run one at a time in enqueue order; a task's
  * failure is isolated so it never wedges later tasks. Internal primitives
  * (_connect, _disconnect, transmit, transmitControl and the _-prefixed command
  * cores) never take a lock - they assume the caller already holds the relevant
  * one - so there is no re-entrancy / deadlock.
  */
  _makeLock: function () {
    let chain = Promise.resolve();
    return function (task) {
      const result = chain.then(function () { return task(); });
      chain = result.then(function () { }, function () { });
      return result;
    };
  },

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
        if (reader_util.isValidReader(reader)) {
          service._registerCardReader(reader, error_callback, debug);
        } else {
          service._registerPeripheralReader(reader);
        }
      });

      // Resolve init at this point
      logger.log('Init completed');
      return resolve();
    });
  },


  /**
  * Wire up the PICC (contactless card) reader.
  */
  _registerCardReader: function (reader, error_callback, debug) {
    // Status handler
    reader.on('status', function (status) {
      service.handleStatusChange(status);
    });

    // Reader removed handler
    reader.on('end', async function () {
      logger.log('Reader removed - reader end');
      service.callback({ id: "READER_END", name: "Reader was disconnected" });

      try {
        await service._disconnect();
      } catch (err) {
        logger.log("Reader end disconnect error:", err);
      }
      service.reader = null;
      service.cardPresent = false;
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
      // reader.close();

      error_callback({ error: err, error_code: 'READER_ERROR' });
    });

    logger.log('Reader found (PICC):', reader.name);
    service.callback({ id: "READER_FOUND", name: "Reader was connected", data: reader });
    service.reader = reader;
  },


  /**
  * Keep a single non-PICC handle open to carry LCD/peripheral escape commands.
  * The LCD is a device-level peripheral, so any slot's handle drives it via the
  * escape command; we keep the first non-PICC reader and close any extras. If no
  * peripheral handle is available (e.g. a stack that only exposes the PICC) the
  * LCD path falls back to the PICC handle - see _wrapCommands.
  */
  _registerPeripheralReader: function (reader) {
    if (service.peripheralReader) {
      // Already have one; we don't need more than a single escape channel.
      return reader.close();
    }

    service.peripheralReader = reader;
    logger.log('Peripheral (LCD) reader kept:', reader.name);

    reader.on('error', function (err) {
      logger.log('Peripheral reader error:', err);
    });

    reader.on('end', function () {
      logger.log('Peripheral reader removed');
      service.peripheralReader = null;
    });

    // We do not attach a 'status' handler: cards in the SAM slot are irrelevant
    // to this handle's sole job (carrying LCD escape commands).
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
    service.peripheralReader = null;
    service.pcsc_instance = null;
    service.connectionProtocol = null;
    service.cardPresent = false;
    reader_util.rejectWaitingRequestsCallbacks(service.waitingRequests);
    service.waitingRequests = {};
  },


  /**
  * Handle reader status change.
  *
  * The transition is computed from the reader state captured at the moment the
  * event fired (prevState), then the actual connect/disconnect work runs under
  * the card lock so it cannot interleave with a card data command on the same
  * handle. LCD commands live on a different handle/lock and are unaffected.
  * @return {void}
  */
  handleStatusChange: function (status) {
    const reader = service.reader;
    const prevState = reader.state;
    const changes = prevState ^ status.state;

    if (prevState && (changes & reader.SCARD_STATE_EMPTY) && (status.state & reader.SCARD_STATE_EMPTY)) {
      logger.log('Card removed');
      service.cardPresent = false;

      return service._cardRun(async function () {
        try {
          await service._disconnect();
        } catch (err) {
          logger.log("Handle status change disconnect error:", err);
        }
      });
    } else if ((changes & reader.SCARD_STATE_PRESENT) && (status.state & reader.SCARD_STATE_PRESENT)) {
      logger.log('Card present');
      service.cardPresent = true;

      return service._cardRun(async function () {
        try {
          await service._connect(reader_util.CONN_MODE(service.reader), reader_util.CARD_PROTOCOL);
        } catch (err) {
          logger.log("Card present ERROR CONNECTING", err);
          return;
        }
        // Fire any parked requests (readUUID / readNDEF / ...). These re-enter
        // the public API and queue behind this handler on the card lock; they
        // are not awaited here, so the handler releases the lock and they run
        // next.
        reader_util.performCardPresentCallbacks(service.waitingRequests);
      });
    }
  },


  /**
  * Connect to the PICC reader with share mode and protocol (card path).
  * Stores the negotiated card transfer protocol used by transmit().
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
  * Connect a handle in DIRECT mode for peripheral / LCD escape commands.
  *
  * Per the ACR1222L API v1.04, peripheral commands (LCD, LED, buzzer) are
  * PC_to_RDR_Escape commands and require no card. control() still needs an open
  * connection, so we open a DIRECT one. Deliberately does NOT touch
  * service.connectionProtocol: escape commands carry no card transfer protocol,
  * and overwriting it would corrupt card transmit().
  *
  * @param {object} target - reader handle to connect (defaults to PICC)
  */
  _connectDirect: async function (target) {
    const reader = target || service.reader;
    if (reader.connected) return;

    logger.log('Connect (DIRECT) for escape commands on:', reader.name);
    return new Promise(function (resolve, reject) {
      reader.connect(
        { share_mode: reader.SCARD_SHARE_DIRECT, protocol: reader_util.CTRL_PROTOCOL },
        function (err) {
          if (err) {
            logger.log('Error connecting (DIRECT):', err);
            return reject(err);
          }
          logger.log('Connected (DIRECT) for escape commands on:', reader.name);
          resolve();
        }
      );
    });
  },


  /**
  * Disconnect from the PICC reader (card path). Clears the card protocol.
  */
  _disconnect: async function () {
    if (!service.reader) {
      logger.log('No reader to disconnect from');
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
  * Disconnect an arbitrary handle without touching the card protocol. Used to
  * reset the peripheral handle after a failed escape command.
  * @param {object} target - reader handle to disconnect
  */
  _disconnectReader: async function (target) {
    const reader = target || service.reader;
    if (!reader) return true;

    return new Promise(function (resolve, reject) {
      reader.disconnect(reader.SCARD_LEAVE_CARD, function (err) {
        if (err) {
          logger.log('Error disconnecting reader:', err.message);
          return reject(err);
        }
        resolve(true);
      });
    });
  },


  /**
  * Transmit control (escape) command. Peripheral / LCD commands go here per
  * ACR1222L API v1.04 6.0: implemented as PC_to_RDR_Escape, vendor IOCTL 3500.
  * Internal primitive - caller must hold the relevant lock.
  * @param {Buffer} cmd - escape command bytes
  * @param {object} target - reader handle to send on (defaults to PICC)
  */
  transmitControl: async function (cmd, target) {
    const reader = target || service.reader;
    return new Promise(function (resolve, reject) {
      if (!reader) return reject(new Error("Reader not connected"));
      reader.control(cmd, reader.SCARD_CTL_CODE(3500), 40, function (err, data) {
        if (err) return reject(err);
        resolve(data);
      });
    });
  },


  /**
  * Transmit card command. Internal primitive - caller must hold the card lock.
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
  * Reactivate ("wake") a card that dropped to HALT after a failed access, so
  * the next command (e.g. PWD_AUTH) can run. The exact frame is platform
  * specific - see reader_util.CMD_REACTIVATE.
  *
  * Alternative (Option A): a driver-level warm reset works on both OSes with no
  * hand-built frame - disconnect(SCARD_RESET_CARD) then _connect(). Left as the
  * raw-frame form for now because those frames are already verified per-OS:
  *
  *   await new Promise((res, rej) => service.reader.disconnect(
  *     service.reader.SCARD_RESET_CARD, e => e ? rej(e) : (service.connectionProtocol = null, res())));
  *   return service._connect(reader_util.CONN_MODE(service.reader), reader_util.CARD_PROTOCOL);
  */
  reactivateCard: async function () {
    return service._cardRun(function () { return service._reactivateCard(); });
  },
  _reactivateCard: async function () {
    logger.log('Reactivate card');
    return await service.transmit(reader_util.CMD_REACTIVATE);
  },

  /**
  * Send a batch of peripheral/LCD escape commands atomically.
  *
  * Preferred path: over the dedicated peripheral handle, whose DIRECT connection
  * is opened once and kept open (no per-batch connect/disconnect churn, so rapid
  * LCD updates stay fast). This runs on its own lock and does not touch the card
  * handle at all. Fallback path (no peripheral handle available): over the PICC
  * handle under the card lock - connect DIRECT if idle, or reuse the card's
  * connection when a card is present, disconnecting only what we opened.
  *
  * Commands are queued, never dropped: if another batch is running this waits
  * its turn.
  */
  _wrapCommands: async function (cmds) {
    // Callers often issue LCD commands right after initialize(), before the
    // reader-enumeration events have fired, or before the reader is plugged in.
    // Wait (bounded) for a usable handle instead of failing with a confusing
    // "Reader not connected".
    await service._awaitLcdReady();

    if (service.peripheralReader) {
      return service._lcdRun(function () { return service._runLCDCommandsPeripheral(cmds); });
    }
    if (service.reader) {
      return service._cardRun(function () { return service._runLCDCommandsPICC(cmds); });
    }
    throw new AppError('No reader available for LCD commands', 'NO_READER');
  },

  /**
  * Wait until a handle capable of carrying LCD escape commands is available.
  * Prefers the dedicated peripheral handle; on hardware the SAM handles appear
  * in the same enumeration burst as the PICC, so a short grace period lets the
  * peripheral handle win before we consider the PICC fallback.
  *
  * @param {number} timeoutMs - max time to wait for any handle
  * @param {number} peripheralGraceMs - extra wait for the peripheral handle once
  *   the PICC handle is present
  */
  _awaitLcdReady: async function (timeoutMs = 5000, peripheralGraceMs = 750) {
    const start = Date.now();
    let readerSeenAt = null;

    while (!service.peripheralReader) {
      if (service.reader) {
        if (readerSeenAt === null) readerSeenAt = Date.now();
        // PICC is up; give the peripheral handle a brief chance, then fall back.
        if (Date.now() - readerSeenAt >= peripheralGraceMs) return;
      }
      if (Date.now() - start >= timeoutMs) return;
      await new Promise(function (r) { setTimeout(r, 50); });
    }
  },

  _runLCDCommandsPeripheral: async function (cmds) {
    const target = service.peripheralReader;
    if (!target) {
      // Peripheral handle vanished between the check and here - fall back.
      return service._cardRun(function () { return service._runLCDCommandsPICC(cmds); });
    }

    if (!target.connected) await service._connectDirect(target);

    try {
      for (let i = 0; i < cmds.length; i++) {
        await service.transmitControl(cmds[i], target);
      }
    } catch (err) {
      logger.log('Peripheral LCD command failed; resetting peripheral connection', err);
      // Drop the (possibly stale) connection so the next batch reconnects clean.
      try { await service._disconnectReader(target); } catch (e) { /* ignore */ }
      throw err;
    }

    return true;
  },

  _runLCDCommandsPICC: async function (cmds) {
    let needsDisconnect = false;

    if (service.reader && !service.reader.connected) {
      await service._connectDirect(service.reader);
      needsDisconnect = true;
    }

    try {
      for (let i = 0; i < cmds.length; i++) {
        await service.transmitControl(cmds[i], service.reader);
      }
    } finally {
      if (needsDisconnect) {
        try {
          await service._disconnect();
        } catch (err) {
          logger.log("Error disconnecting from reader - _wrapCommands", err);
        }
      }
    }

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
  * Set LCD contrast
  * @param {number} contrast - Contrast level of LCD (0-15)
  */
  setLCDContrast: async function (contrast = 0) {
    logger.log('Set LCD contrast:', contrast);
    return await service._wrapCommands([reader_util.getLCDContrastControlCmd(contrast)]);
  },


  /**
  * Write to reader screen
  * @param {string} row1 - Text for row 1 - max 16 characters
  * @param {string} row2 - Text for row 2 - max 16 characters
  */
  writeToLCD: async function (row1 = '', row2 = '') {
    logger.log('Write to LCD:', row1, row2);
    // Text (ASCII mode) changes the screen; drop the graphic baseline so the
    // next displayImage does a full redraw rather than diffing against a frame
    // that is no longer on screen.
    service._lastFrame = null;
    return await service._wrapCommands([
      reader_util.CMD_BACKLIGHT_ON,
      reader_util.getLCDTextCmd(row1, 1),
      reader_util.getLCDTextCmd(row2, 2)
    ]);
  },


  /**
  * Display image
  * Image must be PNG format with 128x32 pixels.
  *
  * Only the lines that changed since the previous displayImage are sent. Each
  * graphic write costs ~1.1 ms/byte on the reader, so on animation (repeated
  * displayImage calls) this can be dramatically faster than a full 512-byte
  * redraw. The first call after init/clear/writeToLCD redraws in full.
  * @param {string} imagePath - Path to PNG image file
  * @param {PNGWithMetadata} PNGWithMetadata - PNG image buffer
  */
  displayImage: async function (imagePath, PNGWithMetadata) {
    logger.log('Display image on LCD:', imagePath);
    const addressing = await service._resolveAddressing();
    const frame = reader_util.buildImageFrame(imagePath, PNGWithMetadata);

    const full = !(service._lastFrame && service._lastFrame.length === frame.length);
    let cmds;
    if (addressing === 'line') {
      // Incremental sends only changed lines; full redraw (re)asserts backlight.
      cmds = full
        ? [reader_util.CMD_BACKLIGHT_ON].concat(reader_util.getImageLineCmdsFromFrame(frame))
        : reader_util.getImageLineDiffCmdsFromFrame(frame, service._lastFrame);
    } else {
      cmds = full
        ? [reader_util.CMD_BACKLIGHT_ON].concat(reader_util.getImageCmdFromFrame(frame))
        : reader_util.getImageDiffCmdFromFrame(frame, service._lastFrame);
    }

    service._lastFrame = frame;

    if (cmds.length === 0) return true; // nothing changed on screen
    return await service._wrapCommands(cmds);
  },


  /**
  * Force the LCD graphic-mode addressing scheme, overriding auto-detection.
  * @param {string} mode - 'auto' | 'line' | 'block'
  */
  setLCDAddressing: function (mode) {
    if (mode !== 'auto' && mode !== 'line' && mode !== 'block') {
      throw new AppError("LCD addressing must be 'auto', 'line' or 'block'", 'BAD_ADDRESSING');
    }
    logger.log('Set LCD addressing:', mode);
    service.lcdAddressing = mode;
    service._resolvedAddressing = (mode === 'auto') ? null : mode;
    service._lastFrame = null; // scheme change invalidates the on-screen baseline
    return true;
  },


  /**
  * Resolve which graphic-mode addressing to use. Honors a manual override; in
  * 'auto' reads the firmware version once and picks line (3xx) vs block (4xx).
  */
  _resolveAddressing: async function () {
    if (service.lcdAddressing !== 'auto') return service.lcdAddressing;
    if (service._resolvedAddressing) return service._resolvedAddressing;

    let mode = 'block'; // fallback if the version can't be read
    try {
      const fw = await service.getFirmwareVersion();
      const m = /V\s*(\d+)/i.exec(fw || '');
      const major = m ? parseInt(m[1], 10) : 0;
      // Firmware 4xx (and newer) uses the 16x16-block layout; 3xx uses scanlines.
      mode = major >= 400 ? 'block' : 'line';
      logger.log(`LCD addressing auto-detected: '${mode}' (firmware '${fw}')`);
    } catch (err) {
      logger.log(`LCD addressing auto-detect failed, defaulting to '${mode}':`, err && err.message);
    }
    service._resolvedAddressing = mode;
    return mode;
  },


  /**
  * Read the reader firmware version string (e.g. "ACR1222L-U V314.00") via the
  * peripheral escape channel. Cached on service.firmwareVersion.
  */
  getFirmwareVersion: async function () {
    return service._lcdRun(async function () {
      const target = service.peripheralReader || service.reader;
      if (!target) throw new Error('No reader available to read firmware');
      if (!target.connected) await service._connectDirect(target);

      const resp = Buffer.from(await service.transmitControl(reader_util.CMD_GET_FIRMWARE, target));
      // Response: E1 00 00 00 <len> <ascii...>
      const ascii = resp.slice(5).toString('ascii');
      service.firmwareVersion = ascii;
      logger.log('Firmware version:', ascii);
      return ascii;
    });
  },


  /**
  * Clear reader screen
  */
  clearLCD: async function () {
    logger.log('Clear LCD');
    service._lastFrame = null;
    return await service._wrapCommands([
      reader_util.CMD_BACKLIGHT_OFF,
      reader_util.getLCDClearCmd(),
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

    return service._cardRun(function () { return service._writeBuffer(buffer, addr); });
  },
  _writeBuffer: async function (buffer, addr) {
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

    return service._cardRun(function () { return service._readUUID(); });
  },
  _readUUID: async function () {
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

    return service._cardRun(function () { return service._readBytes(addr, num_bytes); });
  },
  _readBytes: async function (addr, num_bytes = 4) {
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

    return service._cardRun(function () { return service._authenticateNTAG(pwd); });
  },
  _authenticateNTAG: async function (pwd) {
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

    return service._cardRun(function () { return service._authenticateUltralightC(keys); });
  },
  _authenticateUltralightC: async function (keys) {
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
      return await service._cardRun(function () { return service._readNDEF(addr_start, addr_end); });
    } catch (err) {
      // The read failed - typically the card was removed mid-read. Wait for the
      // next card, exactly like the "no card yet" path above.
      //
      // This re-park MUST live here, outside the card lock. If _readNDEF instead
      // returned this never-settling "wait for card" promise as the _cardRun
      // task's result, the FIFO lock would wedge forever (its chain only advances
      // when a task settles), stalling every later card operation - including the
      // card-present handler that fires this parked request.
      logger.log('Error during read NDEF. Please present the card to the reader');
      return new Promise(function (resolve, reject) {
        service.waitingRequests.readNDEFRequest = { resolve: resolve, reject: reject, func: service.readNDEF, params: [addr_start, addr_end] }
      });
    }
  },
  _readNDEF: async function (addr_start = 0x04, addr_end = 0x27) {
    // Runs inside the card lock; on any failure it throws so the lock task
    // settles and the lock advances. readNDEF turns that throw into a re-park.
    let data = null;
    try {
      data = await service._fastRead(addr_start, addr_end);
    } catch (err) {
      logger.log('Fast read command failed. Retrying with READ command');
      await service._reactivateCard();

      data = Buffer.alloc(0);
      let addr = addr_start;
      for (; addr <= addr_end; addr++) {
        let read = await service._readBytes(addr, 4);
        data = Buffer.concat([data, read]);
      }
    }

    const response = await reader_util.getNDEFData(data);
    response.uuid_bytes = await service._readUUID();
    response.uuid = response.uuid_bytes.toString('hex').toUpperCase();

    return response;
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
    return service._cardRun(function () { return service._fastRead(addr_start, addr_end); });
  },
  _fastRead: async function (addr_start = 0x04, addr_end = 0x27) {
    logger.log('Fast read requested from page: ' + addr_start + ' to page: ' + addr_end);

    let response = await service.transmit(reader_util.wrapCmd(0x3A, Buffer.from([addr_start, addr_end])));

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
    return service._cardRun(function () { return service._getVersion(); });
  },
  _getVersion: async function () {
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


  /**
  *  Sleep for a given number of milliseconds
  */
  _sleep: async function (ms = 1000) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },
};


// Install the per-channel FIFO locks now that _makeLock is available.
service._cardRun = service._makeLock();
service._lcdRun = service._makeLock();


module.exports = service;
