
// Determine OS platform the process is running on. Used to find the correct reader and send appropriate commands
var isWin = /^win/.test(process.platform);
var isOsx = /^darwin/.test(process.platform);

module.exports = {
    // Define correct CTRL_PROTOCOL to be used when establishing a connection
    CTRL_PROTOCOL: (isWin ? 0 : 4),  // 0 for Windows, 4 for macOS and Linux
    CARD_PROTOCOL: 3,  // T1 or T0 - card will decide.

    CONN_MODE: function(reader) {return isWin ? reader.SCARD_SHARE_SHARED : reader.SCARD_SHARE_DIRECT},

    /**
     * ACR1222L presents itself as 4 separate readers to the OS, because of the SAM modules it contains.
     *
     * This function will take a look at readers name and return true or false based on the OS it's running on.
     *
     * @param reader
     * @returns {boolean}
     */
     isValidReader: function(reader) {
        if (isWin) {
            return reader.name.toLowerCase().indexOf('picc 0') > -1
        } else if (isOsx) {
            return ((reader.name.toLowerCase().indexOf('picc') > -1) && (reader.name.toLowerCase().indexOf('(1)') > -1))
        } else {
            return reader.name.toLowerCase().indexOf('00 00') > -1
        }

    },

    setPCSCErrorListener: function(pcsc, error_callback) {
        pcsc.on('error', function(err) {
            //_log('PCSC Error occured:' + err);
            error_callback({error: err, error_code:'PCSC_ERROR'});
            pcsc.close();
        });
    },

    /**
     * Subscribe to reader error messages being emitted by the pcsc library
     * @param reader
     * @param error_callback
     */
    setReaderErrorListeners: function(reader, error_callback) {
        reader.on('end', function () {
            if (isValidReader(reader)) {
                //_log('Reader removed');
                error_callback({error: new Error('Reader removed'), error_code: 'READER_REMOVED'});
            }
        }); // end of END listener

        // set ERROR listener
        reader.on('error', function (err) {
            if (isValidReader(reader)) {
                //_log('Reader error occured' + err);
                error_callback({error: err, error_code: 'READER_ERROR'});
            }
        });
    },

    getLCDTextBuffer: function(text, line) {
        var c = Buffer.from(text);
        var b = Buffer.from([text.length]);

        var LCD = Buffer.from([0xFF, 0x00, 0x68]); // + line number(1B) + length(1B) + text(max 16B)
        var LCD_LINE_1 = 0x00;
        var LCD_LINE_2 = 0x40;

        var l;
        if (line == 1) {
            l = Buffer.from([LCD_LINE_1]);
        }else{
            l = Buffer.from([LCD_LINE_2]);
        }

        return Buffer.concat([LCD, l, b, c]);
    }


};