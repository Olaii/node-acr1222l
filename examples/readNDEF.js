/**
 This example will show you how to read the NDEF message on the card.

 It will output the NDEF to the screen of the device.
 **/

const reader = require('../acr1222l');


function error_cb(err) {
    console.log('Something went horribly wrong: ', err);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


async function main() {
    // First let's initialize the reader. We will use the debug mode, so we can see the log output in console
    await reader.initialize(error_cb, debug=true);

    // Read Card UUID. It will wait until the card is present.
    const ndef_obj = await reader.readNDEF(addr_start=0x04, addr_end=0x0C);
    console.log(ndef_obj);
    await reader.writeToLCD('Card Message:', ndef_obj.ndef);

    await sleep(2000);
    await reader.clearLCD();

    // To stop the NDEF Read if card is not presented in time - let's say you want to stop from the GUI
    await reader.stopNDEFRead();

}


main();
