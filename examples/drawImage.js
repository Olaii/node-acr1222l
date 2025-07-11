/**
 The following examples will show you how to draw an image on LCD screen of ACR1222L Reader.
 **/

const reader = require('../acr1222l'); 

async function main() {
  await reader.initialize((err) => {
    console.log('Something went wrong:', err);
  }, debug = true);
  await reader._sleep(1000);

  await reader.clearLCD();
  await reader.turnOnBacklight();
  await reader.displayImage("./examples/assets/dino.png");

  return;
}

main();



