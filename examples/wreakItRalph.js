/**
 This example will show you how to read the NDEF message on the card.
 It will output the NDEF to the screen of the device.
 **/

const reader = require('../acr1222l');

function error_cb(err) {
  console.log('Something went wrong:', err);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function writeToLcd() {
  return reader.writeToLCD('Tap card', String(Date.now()));
}


async function startReading() {
  await reader.readNDEF(addr_start = 0x04, addr_end = 0x0C);
  return await reader.stopNDEFRead();
}


function randomIntFromInterval(min, max) { // min and max included 
  return Math.floor(Math.random() * (max - min + 1) + min);
}

async function main() {
  try {
    // First let's initialize the reader. We will use the debug mode, so we can see the log output in console
    await reader.initialize(error_cb, debug = true);
    console.log(Date.now())

    await sleep(1000);

    // reader.readNDEF(addr_start = 0x04, addr_end = 0x0C);

    while (true) {
      startReading();
      writeToLcd();
      await sleep(randomIntFromInterval(0, 100));
    }
  } catch(e) {
    console.error(e);
    setTimeout(() => {
      main();
    }, 1000);
  }
}

main();



