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
  await sleep(1000);

  await reader.turnOnBacklight();
  await reader.displayImage("./examples/assets/dino.png");
}

main();



