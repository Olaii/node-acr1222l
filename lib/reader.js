const pcsc = require('@pokusew/pcsclite')();
const events = require('events');
const util = require('./reader_util');
const ndef = require('ndef');

var EventEmitter = events.EventEmitter;

var debugMode = false;
var cardPresent = false;
var connectionProtocol = null;
var cardReadEmitter = new EventEmitter();


// Requested variables
var NDEFReadRequested = false;
var uuidReadRequested = false;

// Promise callbacks
var NDEFReadCallbackObj = null;
var cardUUIDCallbackObj = null;

var service = {
    // Settings
    initialized: false,
    reader: null,
    use_fast_read: false,
    user_space_start: 0x04,
    user_space_end: 0x27,

    init: function(error_callback, use_fast_read=false, user_space_start=0x04, user_space_end=0x27){
        return new Promise(function(resolve, reject) {

            if(service.initialized) {
                return resolve(service.reader);
            }
            // set already init
            service.initialized = true;
            // set variables
            service.use_fast_read = use_fast_read;
            service.user_space_start = user_space_start;
            service.user_space_end = user_space_end;

            util.setPCSCErrorListener(pcsc, error_callback);
            // when new reader is detected...
            pcsc.on('reader', function(reader) {
                // set reader error listeners
                util.setReaderErrorListeners(reader, error_callback);

                // check if current reader is valid - if it is, subscribe to its events.
                if (util.isValidReader(reader)) {
                    _log('Reader found: ' + reader.name);
                    service.reader = reader;

                    // Status handler
                    reader.on('status', function(status) {
                        _handleStatus(reader, status);
                    });

                    cardReadEmitter.on('card_present', handleCardPresentMessage);

                    // Resolve init at this point
                    _log('Init completed');
                    resolve(service.reader);
                } // end if

            }); // end reader event handler
        }); // end Promise
    }, // end init

    /**
     * This method will connect to reader if not yet connected and turn on the LCD backlight.
     *
     * @returns Promise.resolve() or Promise.reject()
     */
    backlightON: function() {
        _log('Turn ON LCD backlight requested');
        return _connect(service.reader.SCARD_SHARE_DIRECT, util.CTRL_PROTOCOL)
            .then(function() { return backlight(true) })
            .then(_disconnect)
            .catch(function(err) {
               _log('Error: ' + err.message);
               _disconnect();
               return Promise.reject(err);
            });
    },

    /**
     * This method will connect to reader if not yet connected and turn off the LCD backlight.
     *
     * @returns Promise.resolve() or Promise.reject()
     */
    backlightOFF: function() {
        _log('Turn OFF LCD backlight requested');
        return _connect(service.reader.SCARD_SHARE_DIRECT, util.CTRL_PROTOCOL)
            .then(function() { return backlight(false) })
            .then(_disconnect)
            .catch(function(err) {
               _log('Error: ' + err.message);
               _disconnect();
               return Promise.reject(err);
            });
    },

    /**
     * Write text to LCD. LCD has 2 lines and each line can display up to 16 characters.
     *
     * The backlight will be turned on automatically.
     *
     * @param text1: Text for the first line of the LCD screen.
     * @param text2: Text for the second line of the LCD screen.
     * @returns Promise.resolve() or Promise.reject()
     */
    writeToLCD: function(text1=' '.repeat(16), text2=' '.repeat(16)) {
        _log('Write to LCD requested');
        return _connect(service.reader.SCARD_SHARE_DIRECT, util.CTRL_PROTOCOL)
            .then(function() { return backlight(true) })
            .then(function() { return writeToLCD(text1, 1) })
            .then(function() { return writeToLCD(text2, 2) })
            .then(_disconnect)
            .catch(function(err) {
               _log('Error: ' + err.message);
               _disconnect();
               return Promise.reject(err);
            });
    },

    /**
     * Writes empty string to the reader screen, essentially removing any displayed text and turn off the
     * backlight
     *
     * @returns Promise.resolve() or Promise.reject()
     */
    clearLCD: function() {
        _log('Clear LCD requested');
        return _connect(service.reader.SCARD_SHARE_DIRECT, util.CTRL_PROTOCOL)
            .then(function() { return backlight(false)})
            .then(function() { return writeToLCD(' '.repeat(16), 1) })
            .then(function() { return writeToLCD(' '.repeat(16), 2) })
            .then(_disconnect)
            .catch(function(err) {
               _log('Error: ' + err.message);
               _disconnect();
                return Promise.reject(err);
            });
    },

    /**
     * Start reading Card UUID. If the card is not present, method will resolve once the UUID has been
     * successfully obtained.
     *
     * The method will always resolve correctly or wait indefinetely. To stop the resolve to happen call stopUUIDRead()
     *
     * @param disconnect - should the reader disconnect from the card after successful read
     *
     * @returns Promise.resolve(uuid)
     */
    readUUID: function(disconnect=true) {
        return new Promise(function(resolve, reject) {
            if(cardPresent) {
                readUUID(disconnect).then(resolve);
            } else {
                uuidReadRequested = true;
                cardUUIDCallbackObj = {resolve: resolve, reject: reject};
            }
        });

    },

    /**
     * Stop UUID read.
     *
     * @returns Promise.resolve()
     */
    stopUUIDRead: function() {
        uuidReadRequested = false;
        cardUUIDCallbackObj = null;
        return Promise.resolve();
    },

    readNDEF: function() {
      return new Promise(function(resolve, reject) {
         if(cardPresent) {
             readNDEF().then(resolve);
         } else {
             NDEFReadRequested = true;
             NDEFReadCallbackObj = {resolve: resolve, reject: reject};
         }
      });
    },

    /**
     * Stop NDEF read.
     *
     * @returns Promise.resolve()
     */
    stopNDEFRead: function() {
        NDEFReadRequested = true;
        NDEFReadCallbackObj = null;
        return Promise.resolve();
    },

    /**
     * Enable debug mode. Will print to console.log every operation.
     */
    debug: function() {
        debugMode = true;
        _log('Debug mode ENABLED');
    }


};

function _log(message) {
    if (debugMode) {
        console.log('[ACR1222L] ' + message);
    }
}



function _handleStatus(reader, status) {
    var changes = reader.state ^ status.state;

    if (reader.state && (changes & reader.SCARD_STATE_EMPTY) && (status.state & reader.SCARD_STATE_EMPTY)) {
        _log('Card removed');
        cardPresent = false;
        if (reader.connected) {
            _disconnect(reader);
        }
    } else if ((changes & reader.SCARD_STATE_PRESENT) && (status.state & reader.SCARD_STATE_PRESENT)){
        _log('Card present');
        cardPresent = true;
        cardReadEmitter.emit('card_present');
    }
}

function _connect(share_mode, protocol) {
    return new Promise(function(resolve, reject) {
        if (service.reader.connected) {
            resolve(connectionProtocol);
        } else {
            _log('Connect requested with SHARE_MODE=' + share_mode  + ' and PROTOCOL=' + protocol);
            service.reader.connect({share_mode: share_mode, protocol: protocol}, function (err, protocol) {
                if (err) {
                    reject(err);
                } else {
                    _log('Connected with protocol: ' + protocol);

                    // Set variables
                    connectionProtocol = protocol;

                    resolve(protocol);
                }

            });
        }

    });
}

function _disconnect() {
    return new Promise(function(resolve, reject) {
        if(service.reader.connected) {
            service.reader.disconnect(service.reader.SCARD_LEAVE_CARD, function (err) {
                if (err) {
                    _log('Error disconnecting: ' + err.message);
                    reject(err);
                } else {
                    _log('Disconnected');
                    // Clean variables
                    connectionProtocol = null;
                    resolve();
                }
            });
        }else {
            resolve();
        }
    });

}

function backlight(on) {
    return new Promise(function(resolve, reject) {
        var CMD = new Buffer([0xFF, 0x00, 0x64, 0xFF, 0x00]);
        if(on) {
            CMD[3] = 0xFF;
        } else {
            CMD[3] = 0x00;
        }

        service.reader.control(CMD, service.reader.SCARD_CTL_CODE(3500), 40, function(err, data){
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}

function writeToLCD(text, line) {
    return new Promise(function (resolve, reject) {
        text = text + ' '.repeat(16);  // add spaces at the end to overwrite any existing text
        var CMD = util.getLCDTextBuffer(text, line);

        service.reader.control(CMD, service.reader.SCARD_CTL_CODE(3500), 40, function(err, data){
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}

function readUUID(disconnect=true) {
    return new Promise(function(resolve, reject) {
        _connect(util.CONN_MODE(service.reader), util.CARD_PROTOCOL)
            .then(function() {
                const UID = new Buffer([0xFF, 0xCA, 0x00, 0x00, 0x00]);
                service.reader.transmit(UID, 40, connectionProtocol, function(err, data) {
                   if (err) {
                       reject(err);
                   } else {
                       resolve(data.slice(0, -2));  // remove 90 00 from UUID as it's part of a success frame
                   }
                });
            })
            .then(function() { if (disconnect) _disconnect() });
        });
}

function readNDEF() {
    return new Promise(function(resolve, reject) {
        _connect(util.CONN_MODE(service.reader), util.CARD_PROTOCOL)
            .then(function() { return performRead() }) // do not limit how many bytes can be read
            .then(getNDEFData)
            .then(appendUUID)
            .then(function(data) {
                // data is an object containing
                // data.original_bytes = Buffer of original read response
                // data.ndef = ndef message
                _log('readNDEF - Data UUID; ' + data.uuid.toString('hex'));
                _log('readNDEF - NDEF data: ' + data.ndef);
                resolve(data); // resolve response
            })
            .then(_disconnect);

    });
}


function performRead(bytes) { // If bytes == undefined - read whole user space.

    _log('Read requested');
    if(service.use_fast_read) {
        _log('Performing FAST_READ command');
        return fastRead(bytes);
    } else {
        _log('Performing READ command');
        return normalRead(bytes); // TODO
    }
}

function normalRead(bytes) {
    return new Promise(function(resolve, reject) {
        const READ_RESPONSE_SIZE = 0x04;
        var start_page = service.user_space_start;
        var end_page = (bytes ? start_page + (bytes / 4) : service.user_space_end);

        var current_page = start_page;

        var read_bytes = Buffer.from([]);

        var read_recursively = function (buffer, current_page) {
            service.reader.transmit(Buffer.from([0x30, current_page]), 16, connectionProtocol, function(err, data){
                if(err) reject(err);
                else {
                    buffer = Buffer.concat([buffer, data]);

                    current_page = current_page + READ_RESPONSE_SIZE;

                    if (current_page > end_page) {
                        resolve(buffer)
                    }
                    else {
                        read_recursively(buffer, current_page);
                    }
                }
            });

        };

        read_recursively(read_bytes, current_page);
  });
}

function fastRead(bytes) {
    return new Promise(function(resolve, reject) {
        const CMD = wrap(0x3A, Buffer.from([service.user_space_start, service.user_space_end]));
        service.reader.transmit(CMD, 1024, connectionProtocol, function(err, data) {
            if(err) {
                _log('Fast read failed: ' + err.message);
                reject(err)
            } else {
                _log('Fast read success');
                if(data[2] == 0) {
                    data = data.slice(3, -2);

                    // Return only bytes that have been requested
                    if (bytes) {
                        data = data.slice(0, bytes);
                    }
                    resolve(data);
                } else {
                    reject(new Error('FAST_READ command failed.'))
                }

            }
        });
    });
}

function getNDEFData(data) {
    return new Promise(function(resolve, reject) {
        if (data.indexOf(0xfe) == -1 || data.indexOf(0xd1) == -1) {
            reject(new Error('Bytes do no not contain NDEF message!'));
        } else {
            var ndef_data = data.slice(data.indexOf(0xd1), data.indexOf(0xfe)).toJSON();
            var record = ndef.decodeMessage(ndef_data.data)[0];

            if (record.tnf === ndef.TNF_WELL_KNOWN && record.type[0] === ndef.RTD_TEXT[0]) {
                var ndef_value = ndef.text.decodePayload(record.payload);
                var response = {
                    original_bytes: data,
                    ndef: ndef_value
                };
                resolve(response)
            } else {
                reject(new Error('Unknown NDEF message'))
            }
        }
    });

}

function appendUUID(data) {
    return readUUID(false).then(function(uuid) {
        data.uuid = uuid.toString('hex').toUpperCase();
        data.uuid_bytes = uuid;
        return Promise.resolve(data);
    })
}

function handleCardPresentMessage() {
    if(uuidReadRequested) {
        readUUID().then(function(uuid) {
            uuidReadRequested = false;
            if (cardUUIDCallbackObj) cardUUIDCallbackObj.resolve(uuid);
            cardUUIDCallbackObj = null;
        }, function(err) {
            _log('UUID read failed, retrying once card is available...');
        })
    }

    if(NDEFReadRequested) {
        readNDEF().then(function(data) {
            NDEFReadRequested = false;
            if (NDEFReadCallbackObj) NDEFReadCallbackObj.resolve(data);
            NDEFReadCallbackObj = null;
        }, function(err) {
            _log('NDEF read failed. Retrying with next card...')
        });
    }

}

function wrap(cmd, dataIn){
    /*{
      0xFF, //CLA
      0x00, //INS
      0x00, //P1
      0x00, //P2
      0x07, //LC // - total lenght  with D4h and 42h
      0xD4, 0x42, //InCommunicateThru
      0x1B, //PWD_AUTH (See data sheet) - CMD here
      Password,  // payload - instruction data
      Password >> 8,
      Password >> 16,
      Password >> 24,
    };*/
    return new Buffer([0xFF, 0x00, 0x00, 0x00, dataIn.length + 3, 0xD4, 0x42, cmd, ...dataIn]);
}

module.exports = service;