let pcsc = require('@pokusew/pcsclite');
const reader_util = require('./reader_util');
const logger = require('./logger');
const des = require('./DESede');
const AppError = require('./exceptions');


const service = {
    initialized: false,
    reader: null,

    connectionProtocol: null,

    cardPresent: false,
    waitingRequests: {},


    initialize: async function(error_callback, debug=false) {
        return new Promise(function(resolve, reject) {

            logger.debug = debug;

            if(service.initialized) {
                return resolve();
            }

            service.initialized = true;
            pcsc = pcsc();
            pcsc.on('error', function(err) {
                logger.log('PCSC Error occured:', err);
                error_callback({error: err, error_code:'PCSC_ERROR'});
                pcsc.close();
            });

            pcsc.on('reader', function(reader) {
                if (reader_util.isValidReader(reader)) {
                    logger.log('Reader found: ', reader.name);

                    // Status handler
                    reader.on('status', function(status) {
                        service.handleStatusChange(status);
                    });

                    // Reader removed handler
                    reader.on('end', function() {
                        logger.log('Reader removed');
                        error_callback({error: new Error('Reader removed'), error_code: 'READER_REMOVED'})
                    });

                    // Reader error handler
                    reader.on('error', function (err) {
                        logger.log('Reader error occured: ', err);
                        error_callback({error: err, error_code: 'READER_ERROR'});
                    });

                    // Resolve init at this point
                    logger.log('Init completed');
                    service.reader = reader;

                    return resolve();
                } // end if validReader
            }); // end pcsc.on('reader')
        }); // end Promise
    }, // end initialize function

    handleStatusChange: async function(status) {
        const changes = service.reader.state ^ status.state;

        if (service.reader.state && (changes & service.reader.SCARD_STATE_EMPTY) && (status.state & service.reader.SCARD_STATE_EMPTY)) {
            logger.log('Card removed');
            service.cardPresent = false;
            if (service.reader.connected) {
                await service.disconnect();
            }
        } else if ((changes & service.reader.SCARD_STATE_PRESENT) && (status.state & service.reader.SCARD_STATE_PRESENT)) {
            logger.log('Card present');
            service.cardPresent = true;

            reader_util.performCardPresentCallbacks(service.waitingRequests);
        }
    },

    connect: async function(share_mode, protocol) {
        logger.log('Connect requested with SHARE_MODE=' + share_mode  + ' and PROTOCOL=' + protocol);

        if(service.reader.connected) {
            return service.connectionProtocol
        }

        return new Promise(function(resolve, reject) {
            service.reader.connect({share_mode: share_mode, protocol: protocol}, function (err, protocol) {
                if (err) {
                    logger.log('Error connecting with reader:', err);
                    reject(err)
                } else {
                    logger.log('Connected with protocol: ', protocol);
                    service.connectionProtocol = protocol;

                    resolve(protocol);
                }
            });
        });
    },

    disconnect: async function() {
        if(service.reader.connected) {

            return new Promise(function(resolve, reject) {
                service.reader.disconnect(service.reader.SCARD_LEAVE_CARD, function (err) {
                    if (err) {
                        logger.log('Error disconnecting: ', err.message);
                        reject(err);
                    } else {
                        logger.log('Disconnected');
                        // Clean variables
                        service.connectionProtocol = null;
                        resolve(true);
                    }
                });
            });
        }
        logger.log('Reader was not connected');
        return true;
    },

    transmitControl: async function(cmd) {
        return new Promise(function(resolve, reject) {
            service.reader.control(cmd, service.reader.SCARD_CTL_CODE(3500), 40, function(err, data){
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            });
        });
    },

    transmit: async function(cmd) {
        return new Promise(function(resolve, reject) {
            service.reader.transmit(cmd, 1024, service.connectionProtocol, function(err, data){
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            });
        });
    },

    turnOnBacklight: async function() {
        logger.log('Turning ON Backlight');
        await service.connect(service.reader.SCARD_SHARE_DIRECT, reader_util.CTRL_PROTOCOL);
        await service.transmitControl(reader_util.CMD_BACKLIGHT_ON);
        await service.disconnect();

        return true;
    },

    turnOffBacklight: async function() {
        logger.log('Turning OFF Backlight');
        await service.connect(service.reader.SCARD_SHARE_DIRECT, reader_util.CTRL_PROTOCOL);
        await service.transmitControl(reader_util.CMD_BACKLIGHT_OFF);
        await service.disconnect();

        return true;
    },

    writeToLCD: async function(row1='', row2='') {
        logger.log('Writing to LCD');
        await service.connect(service.reader.SCARD_SHARE_DIRECT, reader_util.CTRL_PROTOCOL);
        await service.transmitControl(reader_util.CMD_BACKLIGHT_ON);

        await service.transmitControl(reader_util.getLCDTextCmd(row1, 1));
        await service.transmitControl(reader_util.getLCDTextCmd(row2, 2));

        await service.disconnect();

        return true;
    },

    clearLCD: async function() {
        logger.log('Clearing LCD');
        await service.connect(service.reader.SCARD_SHARE_DIRECT, reader_util.CTRL_PROTOCOL);
        await service.transmitControl(reader_util.CMD_BACKLIGHT_OFF);
        await service.transmitControl(reader_util.getLCDTextCmd(' ', 1));
        await service.transmitControl(reader_util.getLCDTextCmd(' ', 2));

        await service.disconnect();

    },

    writeBuffer: async function(buffer, addr) {
        logger.log('Write Buffer requested. Buffer: ', buffer);

        if(!service.cardPresent) {
            return new Promise(function(resolve, reject) {
                // Wait for the card to be attached
                service.waitingRequests.writeBufferRequest = {resolve: resolve, reject: reject, func: service.writeBuffer, params: [buffer, addr]}
            });
        }

        await service.connect(reader_util.CONN_MODE(service.reader), reader_util.CARD_PROTOCOL);
        let response = await service.transmit(reader_util.CMD_WRITE(buffer, addr));

        if(response[0] === 0x90) {
            logger.log('Write successful');
        } else if(response[0] === 0xfe) {
            logger.log('Write failed. Card is locked!');
            throw new AppError('Write failed. Card is locked!', status='CARD_LOCKED');
        } else {
            logger.log('Write failed with error code: ', response[0]);
            throw new AppError('Write failed with Error code: ' + response[0], 'WRITE_FAILED')
        }

        return true
    },

    stopWriteBuffer: async function() {
        logger.log('Stop Write Buffer');
        delete service.waitingRequests.writeBufferRequest;

        return true;
    },

    readUUID: async function() {
        logger.log('Read UUID requested.');

        if(!service.cardPresent) {
            return new Promise(function(resolve, reject) {
                // Wait for the card to be attached
                service.waitingRequests.readUUIDRequest = {resolve: resolve, reject: reject, func: service.readUUID, params: []}
            });
        }

        await service.connect(reader_util.CONN_MODE(service.reader), reader_util.CARD_PROTOCOL);
        let uuid = await service.transmit(reader_util.CMD_READ_UUID);

        uuid = uuid.slice(0, -2);
        logger.log('Card UUID Read: ', uuid);

        return uuid
    },

    stopReadUUID: async function() {
        logger.log('Stop UUID Read');
        delete service.waitingRequests.readUUIDRequest;

        return true;
    },

    readBytes: async function(addr, num_bytes=4, wait_for_card=false) {
        logger.log('Read ' + num_bytes + ' on addr:', addr);

        if(!service.cardPresent && wait_for_card) {
            return new Promise(function(resolve, reject) {
                // Wait for the card to be attached
                service.waitingRequests.readBytesRequest = {resolve: resolve, reject: reject, func: service.readBytes, params: [addr, num_bytes]}
            });
        } else if(!service.cardPresent && wait_for_card === false) {
            throw new AppError('Card not present!', status='CARD_NOT_PRESENT')
        }

        await service.connect(reader_util.CONN_MODE(service.reader), reader_util.CARD_PROTOCOL);

        let response = Buffer(await service.transmit(reader_util.CMD_READ_BYTES(addr, num_bytes)));


        if(response.slice(-2,-1)[0] === 0x90) {
            logger.log('Read bytes successful');
        } else {
            throw new AppError('Read bytes failed!', status='READ_FAILED')
        }

        return response.slice(0, -2);
    },

    stopReadBytes: function() {
        logger.log('Stop Read Bytes Read');
        delete service.waitingRequests.readBytesRequest;

        return true;
    },

    authenticate: async function(pwd) {
        return await authenticateNTAG(pwd);
    },

    authenticateNTAG: async function(pwd) {
        logger.log('Authenticated called');

        if(!service.cardPresent) {
            throw new AppError('Cant authenticate as the card is not present', status='CARD_NOT_PRESENT');
        }

        await service.connect(reader_util.CONN_MODE(service.reader), reader_util.CARD_PROTOCOL);
        let pack = await service.transmit(reader_util.wrapCmd(0x1b, pwd));

        if(pack[2] === 0x00) {
            logger.log('Authentication successful. PACK: ', pack.slice(3, 5));
        } else {
            logger.log('Wrong PWD. Authentication failed!');
            throw new AppError('Wrong password. Authentication failed!', status='WRONG_PASSWORD');
        }

        return pack.slice(3, 5);
    },

    authenticateUltralightC: async function(keys) {
        logger.log('Authenticated called');

        if(!service.cardPresent) {
            throw new AppError('Cant authenticate as the card is not present', status='CARD_NOT_PRESENT');
        }

        await service.connect(reader_util.CONN_MODE(service.reader), reader_util.CARD_PROTOCOL);

        des.init(keys);
        let rndA = Buffer.alloc(8);
        for(var i=0; i < rndA.length; i++){
           rndA[i] = Math.floor(Math.random()*256);
        }

        let hcRndB = await service.transmit(reader_util.wrapCmd(0x1A));
        let rndB = des.decrypt(hcRndB.slice(1, hcRndB.length));
        let rndBr = service._rotateLeft(rndB);

        let rndArndBr = Buffer.concat([rndA, rndBr])
        let cRndArndBr = des.encrypt(rndArndBr);

        let hcRndAr = await service.transmit(reader_util.wrapCmd(0xAF, cRndArndBr));
        let rndAr = des.decrypt(hcRndAr.slice(1, hcRndAr.length));
        let rndA2 = service._rotateRight(rndAr);

        if(Buffer.compare(rndA, rndA2) != 0){
            logger.log('Wrong PWD. Authentication failed!');
            throw new AppError('Wrong password. Authentication failed!', status='WRONG_PASSWORD');
        }

        return;
    },

    readNDEF: async function(addr_start=0x04, addr_end=0x27) {
        if(!service.cardPresent) {
            return new Promise(function(resolve, reject) {
                // Wait for the card to be attached
                service.waitingRequests.readNDEFRequest = {resolve: resolve, reject: reject, func: service.readNDEF, params: [addr_start, addr_end]}
            });
        }

        try {
            const data = await service.fastRead(addr_start, addr_end);
            const response = await reader_util.getNDEFData(data);
            response.uuid_bytes = await service.readUUID();
            response.uuid = response.uuid_bytes.toString('hex').toUpperCase();

            return response
        } catch(err) {
            logger.log('Error during read NDEF. Please present the card to the reader');
            return new Promise(function(resolve, reject) {
                // Wait for the card to be attached
                service.waitingRequests.readNDEFRequest = {resolve: resolve, reject: reject, func: service.readNDEF, params: [addr_start, addr_end]}
            });
        }
    },

    stopNDEFRead: function() {
        logger.log('Stop NDEF Read');
        delete service.waitingRequests.readNDEFRequest;

        return true;
    },

    fastRead: async function(addr_start=0x04, addr_end=0x27) {
        logger.log('FastRead Requested from page: ' + addr_start + ' to page: ' + addr_end);

        await service.connect(reader_util.CONN_MODE(service.reader), reader_util.CARD_PROTOCOL);
        let response = await service.transmit(reader_util.wrapCmd(0x3A, Buffer([addr_start, addr_end])));

        if(response[2] === 0x00) {
            response = response.slice(3, -2);
        } else {
            throw new AppError('FAST_READ command failed.', status='FAST_READ_FAILED')
        }

        return response
    },

    _rotateLeft: function(array){
        let ret = Buffer.from(array);

        for(var i=1; i<array.length; i++){
            ret[i-1] = ret[i];
        }

        ret[ret.length-1]=array[0];
        return ret;
    },

    _rotateRight: function(array){
        let ret = Buffer.from(array);

        for(var i=array.length-2; i >= 0; i--){
            ret[i+1] = ret[i];
        }

        ret[0]=array[ret.length-1];
        return ret;
    },
};


module.exports = service;
