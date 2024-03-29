/**
 The following examples will show you how to manipulate the LCD screen of ACR1222L Reader.
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
  await reader.initialize(error_cb, debug = true);

  // Let's turn on LCD Backlight
  await reader.turnOnBacklight();

  // Keep it on for 2 seconds
  await sleep(2000);

  // and let's turn it back off
  await reader.turnOffBacklight();

  // wait for two more seconds...
  await sleep(2000);

  //let's write something to the screen now
  await reader.writeToLCD('Hello world!', 'It is a nice day');

  // Awesome. This worked. Let's keep the text for 2 more seconds and then clear the screen.
  await sleep(2000);
  await reader.clearLCD();
}

main();



