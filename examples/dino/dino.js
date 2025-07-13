const { createCanvas, loadImage } = require('canvas')
const canvas = createCanvas(128, 32)
const ctx = canvas.getContext('2d')
const reader = require('../../acr1222l');
const { PNG } = require('pngjs');

async function main() {
  await reader.initialize((err) => {
    console.log('Something went wrong:', err);
  }, debug = false);
  await reader._sleep(1000);
  await reader.clearLCD();
  await reader.turnOnBacklight();

  let gameStarted = false;
  let dinoJumping = false;
  let jumpTimer = 0;
  let groundPosition = 0;
  const refreshRate = 1500; // milliseconds

  const startScreen = await loadImage('examples/dino/start_screen.png');
  const dinoRun1 = await loadImage("examples/dino/dino_run1.png");
  const dinoRun2 = await loadImage("examples/dino/dino_run2.png");
  const cactus1 = await loadImage("examples/dino/cactus_1.png");
  const groundImage = await loadImage("examples/dino/ground.png");
  let dinoImage = dinoRun1;

  class Cactus {
    constructor(x) {
      this.x = x;
    }

    update() {
      this.x -= 10; // Move cactus to the left
      if (this.x < -13) { // If cactus is off screen
        this.x = 128; // Reset position
      }

      if (this.x < 30 && this.x > 0 && dinoJumping === false && gameStarted) {
        // Collision detection
        console.log("Game Over");
        gameOver();
      }
    }

    draw() {
      ctx.drawImage(cactus1, this.x, 5, 13, 25);
    }
  }

  let cactus = new Cactus(130);

  async function startReading () {
    const cardData = await reader.readNDEF(addr_start = 0x04, addr_end = 0x0C);
    console.log(cardData.ndef);

    if (!gameStarted) {
      startGame();
    }

    else if (!dinoJumping && gameStarted) {
      dinoJumping = true;
      jumpTimer = 0;
    }

    await reader.stopNDEFRead();

    setTimeout(startReading, 1000);
  }

  function drawCanvasOnLCD() {
    const dataURL = canvas.toDataURL('image/png');
    const base64Data = dataURL.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    new PNG({ filterType: 4 }).parse(buffer, function(err, data) {
      if (err) throw err;
      reader.displayImage(null, data);
    })
  }

  function drawStart() {
    console.log("Drawing Start Screen");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(startScreen, 0, 0, 128, 32);
    drawCanvasOnLCD();
  }

  function drawDino() {
    if (dinoImage == dinoRun1) dinoImage = dinoRun2;
    else dinoImage = dinoRun1;
    ctx.drawImage(dinoImage, 1, dinoJumping ? -20 : 0, 30, 32);
  }

  function drawGround() {
    ctx.drawImage(groundImage, -groundPosition, 14, 2400, 18);
  }

  async function update() {
    if (!gameStarted) return;

    // Reset the canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);


    // Move the ground
    groundPosition += 10;
    if (groundPosition >= 2400) {
      groundPosition = 0;
    }

    // Jump logic
    jumpTimer += 1;
    if (jumpTimer == 5) {
      dinoJumping = false;
    }


    drawDino();
    drawGround();

    cactus.draw();
    cactus.update();

    drawCanvasOnLCD();

    setTimeout(update, refreshRate);
  }

  function gameOver() {
    gameStarted = false;
    console.log("Game Over");
    drawStart();
  }

  function startGame() {
    console.log("Game Started");
    cactus = new Cactus(130);
    dinoJumping = false;
    jumpTimer = 0;
    groundPosition = 0;
    dinoImage = dinoRun1;
    gameStarted = true;
    update();
  }

  drawStart();
  startReading();
}

main().catch(console.error);

