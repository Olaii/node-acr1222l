/**
 This example will show you how to read the UUID of the card.

 It will output the UUID to the screen of the device.
 **/

const reader = require('../acr1222l');


async function error_cb(err) {

  console.log('Something went wrong:', err);
  if (err.error_code == 'READER_REMOVED') {
    reader.closePCSC();
    await reader.initialize(error_cb, debug = true);
  }

}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


async function main() {
  // First let's initialize the reader. We will use the debug mode, so we can see the log output in console
  while (true) {
    await reader.initialize(error_cb, debug = true);

    // Read Card UUID. It will wait until the card is present.
    try {
      console.log("new loop");
      const uuid = await reader.readUUID();
      reader.writeToLCD('Card UUID:', uuid.toString('hex'));
      await reader.writeToLCD('Card UUID:', uuid.toString('hex'));

      await sleep(2000);
      await reader.clearLCD();
    } catch (err) {
      console.log("ERRRRRRRRRRRRRRRRRRRRRRRRRR")
    }
  }


}


main();
