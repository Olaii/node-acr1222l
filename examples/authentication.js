/**
 This example will show you how to authenticate the card.

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

async function authenticate(password) {
  try {
    const pack = await reader.authenticate(password);
    await reader.writeToLCD('PACK:', pack.toString('hex'));
  } catch (err) {
    console.log('Error message:', err.message);
    await reader.writeToLCD('Auth failed!', err.message)
  }

  return true
}

async function main() {
  // First let's initialize the reader. We will use the debug mode, so we can see the log output in console
  await reader.initialize(error_cb, debug = true);

  // Let's set the PWD and PACK first on a fresh card. PWD settings are on page 0x2B
  // PWD: 0xFF, 0xFF, 0xFF, 0xFE
  // PACK: 0x11, 0x33(Password Ack to be returned upon successful auth)
  await reader.writeBuffer(Buffer([0xFF, 0xFF, 0xFF, 0xFE, 0x11, 0x33, 0x00, 0x00]), addr = 0x2B);

  // Ok now that we have the password set, let's try to authenticate. Function should return the PACK 0f 0x11, 0x33
  await authenticate(Buffer([0xFF, 0xFF, 0xFF, 0xFE]));

  await sleep(2000);

  // Let's try to authenticate with wrong password
  await authenticate(Buffer([0xFF, 0xFF, 0xFF, 0xFF]));

  // Should we want to stop reading, writing etc. one should call the following functions
  reader.stopReadBytes();
  // or
  reader.stopWriteBuffer();
}

main();
