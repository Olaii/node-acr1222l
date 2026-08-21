/**
 This example will show you how to read the NDEF message on the card.
 It will output the NDEF to the screen of the device.
 **/

const reader = require('../acr1222l');

function error_cb(err) {
  console.log('Something went wrong:', err);
}

const keepAlive = setInterval(function () { }, 5);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function writeToLcd() {
  return reader.writeToLCD('Tap card', String(Date.now()));
}


async function startReading() {
  // readNDEF catches read failures (e.g. the card pulled off mid-read) and
  // re-parks the request to wait for the next card, so it never rejects - unlike
  // readUUID, which would surface SCardTransmit "Transaction failed (0x80100016)"
  // and crash this fire-and-forget call on card removal.
  const ndef = await reader.readNDEF(addr_start = 0x04, addr_end = 0x0C);
  console.log("NDEF:", ndef.ndef);
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



