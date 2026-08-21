const { createCanvas, loadImage } = require('canvas')
const canvas = createCanvas(128, 32)
const ctx = canvas.getContext('2d')
const reader = require('../../acr1222l');

const keepAlive = setInterval(function () { }, 5);

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
  // 0 = draw as fast as the LCD allows (each displayImage only pushes the lines
  // that changed). Raise this to slow the game down.
  const refreshRate = 0; // milliseconds

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

  // Read pixels straight from the canvas and push them to the LCD. No PNG
  // encode/decode round-trip - displayImage only sends the lines that changed.
  async function drawCanvasOnLCD() {
    const img = ctx.getImageData(0, 0, 128, 32);
    await reader.displayImage(null, { width: 128, height: 32, data: Buffer.from(img.data) });
  }

  async function drawStart() {
    console.log("Drawing Start Screen");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(startScreen, 0, 0, 128, 32);
    try { await drawCanvasOnLCD(); } catch (e) { console.error(e); }
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

    // Await the draw so frames don't pile up in the LCD queue (which is what
    // made the game lag further and further behind).
    try { await drawCanvasOnLCD(); } catch (e) { console.error(e); }

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

