/**
 This example will show you how to write binary data to the card.

 You should be familiar with the card you are using - where is the user space etc.

 In this example we will be using NTAG213: https://www.nxp.com/docs/en/data-sheet/NTAG213_215_216.pdf
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

  // NTAG213 User space starts at 0x04
  // Let's check what's written there right now - we will read 4 bytes (size of the page)
  const data = await reader.readBytes(0x04, 4);
  await reader.writeToLCD('Page 0x04 Data:', data.toString('hex'));
  await sleep(2000);
  // Let's write some data to the card on page 0x04
  await reader.writeBuffer(Buffer([0x01, 0xA1, 0x10, 0x01]), 0x04);

  // And now final check if the data really updated?
  const data2 = await reader.readBytes(0x04, 4);
  await reader.writeToLCD('Page 0x04 Write:', data2.toString('hex'));


  // Should we want to stop reading, writing etc. one should call the following functions
  reader.stopReadBytes();
  // or
  reader.stopWriteBuffer();
}

main();
