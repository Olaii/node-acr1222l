/**
 The following examples will show you how to manipulate the LCD screen of ACR1222L Reader.
 **/

const reader = require('../acr1222l');

function error_cb(err) {
  console.log('Something went wrong:', err);
}

async function main() {
  // First let's initialize the reader. We will use the debug mode, so we can see the log output in console
  await reader.initialize(error_cb, debug = true);

  // Give the reader a moment to be detected
  await reader._sleep(1000);

  // Start from a clean screen
  await reader.clearLCD();

  // Let's turn on LCD Backlight
  await reader.turnOnBacklight();
  await reader._sleep(1000);

  // Write something to the screen
  await reader.writeToLCD('Hello world!', 'It is a nice day');
  await reader._sleep(2000);

  // Adjust the LCD contrast (0-15). Bump this up if the text is hard to read.
  await reader.setLCDContrast(10);
  await reader._sleep(1000);

  // Display an image. Image must be a 128x32 PNG.
  await reader.displayImage('./examples/assets/dino_1.png');
  await reader._sleep(2000);
  await reader.displayImage('./examples/assets/dino_2.png');
  await reader._sleep(2000);

  // Clear the screen and turn the backlight off
  await reader.clearLCD();
  await reader.turnOffBacklight();
}

main().catch(console.error);
