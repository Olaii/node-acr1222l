var nfcReader = require('./acr1222l');


function nfc_error_callback(err) {
    console.log('NFC ERROR CODE:', err.error_code);

}

nfcReader.debug();

nfcReader.init(nfc_error_callback)
    .then(function() { return nfcReader.writeToLCD('Line 1', 'Line 2') })
    .then(nfcReader.readNDEF)
    .then(function(data) {
        console.log('NDEF', data.ndef);
        console.log('UUID', data.uuid);
    });



