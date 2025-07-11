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
  await reader.initialize(error_cb, debug = true);

  await sleep(1000);

  await reader.writeToLCD('Tap card', 'to read UUID');

  // Read Card UUID. It will wait until the card is present.
  try {
    const uuid = await reader.readUUID();
    await reader.writeToLCD('Card UUID:', uuid.toString('hex'));

    await sleep(2000);
    await reader.clearLCD();
  } catch (err) {
    console.log("Error", err);
  }

  return main();
}

main();
