const reader = require('./core/reader');
const pcsc = require('@pokusew/pcsclite')();


function error_cb(err) {
    console.log('Woooopsie ', err);
}


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


async function main() {
    await reader.initialize(error_cb, debug=true);
    //await reader.turnOnBacklight();


    await reader.writeToLCD('hello', 'world');

   // await sleep(2000);
   // await reader.writeToLCD('he', 'world');
   // await sleep(2000);
   // await reader.clearLCD();

   //await reader.readUUID();
   // await reader.cancelReadUUID();

    //await reader.writeBuffer(Buffer([0xFF, 0xFF, 0xFF, 0xFE, 0x11, 0x33, 0x00, 0x00]), addr=0x2B);

    //const response = await reader.readBytes(0x04, 8);

    //console.log('Response: ', response);
    //try {
    //    await reader.authenticate(Buffer([0xFF, 0xFF, 0xFF, 0xFE]));
    //}catch(err) {
   //    console.log(err.message);
   // }

   // await reader.turnOffBacklight();
   // await reader.writeToLCD('Hello pussies');

    await reader.readNDEF();
}

process.on('unhandledRejection', error => {
    // Will print "unhandledRejection err is not defined"
    console.log(error)
    console.log('unhandledRejection', error.message);
});

main();