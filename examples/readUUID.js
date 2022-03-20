/**
 This example will show you how to read the UUID of the card.

 It will output the UUID to the screen of the device.
 **/

const reader = require('../acr1222l');


function error_cb(err) {
    console.log('Something went wrong:', err);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


async function main() {
    // First let's initialize the reader. We will use the debug mode, so we can see the log output in console
    await reader.initialize(error_cb, debug=true);

    // Read Card UUID. It will wait until the card is present.
    const uuid = await reader.readUUID();
    await reader.writeToLCD('Card UUID:', uuid.toString('hex'));

    await sleep(2000);
    await reader.clearLCD();


    // To stop the UUID Read if card is not presented in time - let's say you want to stop from the GUI
    await reader.stopReadUUID();

    main();
}


main();
