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


// Keep refreshing the LCD roughly every 10ms, forever. Runs independently of the
// card-reading loop: the LCD lives on the peripheral handle and the card on the
// PICC handle, so these run in parallel. Each write is awaited before the next is
// scheduled, so writes never pile up on the LCD lock.
async function lcdLoop() {
  while (true) {
    await writeToLcd().catch(function (e) { console.log('lcd error:', e.message); });
    await sleep(10);
  }
}

async function main() {
  try {
    // First let's initialize the reader. We will use the debug mode, so we can see the log output in console
    await reader.initialize(error_cb, debug = true);
    console.log(Date.now())

    await sleep(1000);

    // Start the LCD refresh loop (fire-and-forget; it runs for the process life).
    lcdLoop();

    // Read serially: start a read, wait for the response, then read again. Because
    // each read is awaited, the reader gets idle time between reads and card
    // removal is detected cleanly instead of being starved by back-to-back reads.
    while (true) {
      await startReading();
    }
  } catch(e) {
    console.error(e);
    setTimeout(() => {
      main();
    }, 1000);
  }
}

main();



