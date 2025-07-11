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


  await reader.clearLCD();

  // // Let's turn on LCD Backlight
  await reader.turnOnBacklight();

  await sleep(1000);

  // // Keep it on for 2 seconds
  // await sleep(1000);

  // // and let's turn it back off
  // await reader.turnOffBacklight();

  // // wait for two more seconds...
  // await sleep(1000);

  //let's write something to the screen now
  await reader.writeToLCD('Hello world!', 'It is a nice day');

  // Awesome. This worked. Let's keep the text for 1 more second
  await sleep(1000);

  // Display some images now
  await reader.displayImage("./examples/assets/olaii_1.png");
  await sleep(2000);
  await reader.displayImage("./examples/assets/olaii_2.png");
  await sleep(2000);

  // Display some text on the screen
  for (let i = 0; i <= reader.maxNumberOfCharacters; i++) {
    let line2 = "";
    for(let j = 0; j < i; j++) { line2 += "X";}
    await reader.writeToLCD(`Characters: ${i}`, line2);
    await sleep(150);
  }

  await sleep(1000);

  return main();
}

main();



