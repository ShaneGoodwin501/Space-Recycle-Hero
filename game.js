(() => {
  'use strict';

  // =========================
  // Tunable constants
  // =========================
  const CONFIG = {
    METER_TO_PX: 40,
    gravity: 1.62,
    thrustMax: 10,
    torqueAccel: 2.8,
    angularDamping: 0.35,
    linearDamping: 0.02,

    throttleRampPerSec: 0.25,
    fuelBurnBase: 0.08,
    fuelBurnByThrottle: 0.55,

    landingMaxAngleDeg: 21,
    landingMaxVY: 2.0,
    landingMaxSpeed: 2.4,
    landingBounceVY: 3.4,
    landingCrashVY: 5.6,
    landingSettleBounces: 3,
    impactRobustness: 1.4,

    clawRate: 0.7,
    baseRate: 47.5 * Math.PI / 180,
    seg1Rate: 55 * Math.PI / 180,
    seg2Rate: 55 * Math.PI / 180,

    worldWidth: 260,
    terrainStep: 2,
    starCount: 408,
    planetCount: 8,

    cameraSmooth: 4,

    respawnSeconds: 2,

    cargoCount: 51,
    consoleHeightPx: 150,

    supplyShipIntervalSec: 36,
    supplyDropsPerShip: 4,
    trackDeployRate: 5.5,
    trackDriveAccel: 4.8,
    trackDriveMaxSpeed: 1.35,
    landingGearTransitionSec: 2,
  };

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');

  let W = 1280;
  let H = 720;

  function resize() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function getConsoleHeight() {
    const percentCap = H < 700 ? 0.22 : 0.28;
    return Math.max(72, Math.min(CONFIG.consoleHeightPx, Math.floor(H * percentCap)));
  }

  function getGameplayHeight() {
    return Math.max(120, H - getConsoleHeight());
  }

  function getViewCenterY() {
    return getGameplayHeight() * 0.5;
  }

  window.addEventListener('resize', resize);
  resize();

  const keys = new Set();
  const blocked = new Set(['KeyW','KeyA','KeyS','KeyD','KeyI','KeyO','KeyK','KeyL','KeyN','KeyM','Comma','Period','Space','Escape','KeyH','KeyQ','KeyE']);
  function unlockAudioFromUserGesture() {
    initAudio();
    if (game.audio?.ctx && game.audio.ctx.state !== 'running') game.audio.ctx.resume();
  }

  window.addEventListener('keydown', (e) => {
    if (blocked.has(e.code)) e.preventDefault();
    keys.add(e.code);
    unlockAudioFromUserGesture();


    if (e.code === 'Space') {
      if (game.state === 'READY') startMission();
      else if (game.state === 'PLAYING') ship.trayExtended = !ship.trayExtended;
    }
    if (e.code === 'KeyH') {
      if (game.state === 'PLAYING') {
        game.showHelp = !game.showHelp;
        game.paused = game.showHelp;
      } else if (game.state === 'READY') {
        game.showHelp = !game.showHelp;
      }
    }
    if (e.code === 'KeyE' && game.state === 'PLAYING') {
      const tracksMode = ship.tracksExtended || ship.tracksDeploy > 0.05;
      if (!tracksMode) {
        ship.gearExtended = !ship.gearExtended;
      }
    }
    if (e.code === 'KeyQ' && game.state === 'PLAYING') {
      const canToggleOn = !ship.tracksExtended && ship.landed && ship.throttle < 0.02 && Math.hypot(ship.vx, ship.vy) < 0.45;
      const canToggleOff = ship.tracksExtended && ship.landed && Math.hypot(ship.vx, ship.vy) < 0.9;
      if (canToggleOn) {
        ship.tracksExtended = true;
        ship.throttle = 0;
        ship.gearExtended = false;
      } else if (canToggleOff) {
        ship.tracksExtended = false;
        ship.gearExtended = true;
        ship.gearSafetyTimer = 1.2;
      }
    }
    if (e.code === 'Escape' && game.state !== 'CRASHED' && game.state !== 'READY') {
      game.paused = !game.paused;
      if (!game.paused) game.showHelp = false;
    }
  }, { passive: false });
  window.addEventListener('pointerdown', unlockAudioFromUserGesture, { passive: true });
  window.addEventListener('keyup', (e) => {
    if (blocked.has(e.code)) e.preventDefault();
    keys.delete(e.code);
  }, { passive: false });

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const moveTowards = (value, target, maxDelta) => {
    if (Math.abs(target - value) <= maxDelta) return target;
    return value + Math.sign(target - value) * maxDelta;
  };

  function rotate(v, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
  }

  function worldFromLocal(ship, local) {
    const r = rotate(local, ship.angle);
    return { x: ship.x + r.x, y: ship.y + r.y };
  }

  function generateTerrain() {
    const points = [];
    let y = 12;
    for (let x = 0; x <= CONFIG.worldWidth; x += CONFIG.terrainStep) {
      y += (Math.random() - 0.5) * 1.6;
      y = clamp(y, 7, 22);
      points.push({ x, y });
    }

    const pads = [];
    function flattenAt(cx, halfWidth, yLevel) {
      for (const p of points) {
        if (Math.abs(p.x - cx) < halfWidth) p.y = yLevel;
        else if (Math.abs(p.x - cx) < halfWidth + 3) {
          const t = (Math.abs(p.x - cx) - halfWidth) / 3;
          p.y = lerp(yLevel, p.y, t);
        }
      }
    }

    function padOverlapsExisting(cx, width, extraGap = 0.8) {
      const half = width * 0.5 + extraGap;
      return pads.some((pad) => {
        const existingHalf = pad.w * 0.5 + extraGap;
        return Math.abs(cx - pad.x) < half + existingHalf;
      });
    }

    for (let i = 0; i < 3; i++) {
      const x = 35 + i * 70 + (Math.random() * 8 - 4);
      const yPad = sampleHeightRaw(points, x) - 0.6;
      flattenAt(x, 6, yPad);
      pads.push({ kind: 'recycle', x, y: yPad, w: 11, h: 1.4 });
    }

    const refuelTargets = [65, 175];
    for (let i = 0; i < 2; i++) {
      const width = 10;
      let x = refuelTargets[i] + (Math.random() * 6 - 3);
      let attempts = 0;
      while (padOverlapsExisting(x, width) && attempts < 40) {
        x = refuelTargets[i] + (Math.random() * 28 - 14);
        attempts += 1;
      }
      if (padOverlapsExisting(x, width)) {
        const fallback = [18, 95, 150, 230]
          .find((candidate) => !padOverlapsExisting(candidate, width)) ?? refuelTargets[i];
        x = fallback;
      }

      const yPad = sampleHeightRaw(points, x) - 0.4;
      flattenAt(x, 5.5, yPad);
      pads.push({ kind: 'refuel', x, y: yPad, w: width, h: 1.4 });
    }

    return { points, pads };
  }

  function sampleHeightRaw(points, x) {
    if (x <= points[0].x) return points[0].y;
    if (x >= points[points.length - 1].x) return points[points.length - 1].y;
    const step = CONFIG.terrainStep;
    const i = Math.floor(x / step);
    const p1 = points[i], p2 = points[i + 1];
    const t = (x - p1.x) / (p2.x - p1.x);
    return lerp(p1.y, p2.y, t);
  }

  let terrain = generateTerrain();
  let stars = [];
  let planets = [];

  function regenerateStars() {
    stars = Array.from({ length: CONFIG.starCount }, () => ({
      x: Math.random() * CONFIG.worldWidth,
      y: Math.random() * 85 - 18,
      r: Math.random() * 1.8 + 0.2,
      a: Math.random() * 0.72 + 0.18,
    }));

    const palette = ['#5f7cff', '#d39bff', '#ffd38a', '#8de4ff', '#9ad2ff'];
    planets = Array.from({ length: CONFIG.planetCount }, () => ({
      x: Math.random() * CONFIG.worldWidth,
      y: Math.random() * 68 - 14,
      r: Math.random() * 12 + 6,
      color: palette[Math.floor(Math.random() * palette.length)],
      alpha: Math.random() * 0.24 + 0.2,
      phase: Math.random() * Math.PI * 2,
    }));
  }
  regenerateStars();

  function terrainY(x) {
    return sampleHeightRaw(terrain.points, clamp(x, 0, CONFIG.worldWidth));
  }

  function terrainMetrics() {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of terrain.points) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return { minY, maxY, height: Math.max(1, maxY - minY) };
  }

  const shipSpawn = { x: 16, y: 0 };
  const ship = {
    x: shipSpawn.x,
    y: shipSpawn.y,
    vx: 0,
    vy: 0,
    angle: 0,
    av: 0,

    massBase: 1.2,
    cargoMass: 0,

    throttle: 0,
    fuel: 100,

    landed: true,

    crashTimer: 0,

    baseAngle: 0,
    seg1Angle: 2.9,
    seg2Angle: 3.05,
    clawOpen: 1,

    grabbedCargo: null,
    storedCargoIds: [],
    bounceCount: 0,
    settleLock: false,
    invincibleTimer: 0,
    trayExtended: false,
    traySlide: 0,
    tracksExtended: false,
    tracksDeploy: 0,
    gearExtended: false,
    gearDeploy: 0,
    gearSafetyTimer: 0,
  };

  function shipMass() {
    return ship.massBase + ship.cargoMass;
  }

  function getSupportLocals() {
    const gearExtra = shipShape.skidL.y * 0.3 * ship.gearDeploy;
    const trackExtra = 0.16 * ship.tracksDeploy;
    const unsupportedBlend = (1 - ship.gearDeploy) * (1 - ship.tracksDeploy);
    const transitionDrop = 0.14 * unsupportedBlend;
    return {
      left: { x: shipShape.skidL.x, y: shipShape.skidL.y + gearExtra + trackExtra + transitionDrop },
      right: { x: shipShape.skidR.x, y: shipShape.skidR.y + gearExtra + trackExtra + transitionDrop },
    };
  }

  function getTrayRect() {
    const slideOffset = (1 - ship.traySlide) * 1.15;
    return {
      x: shipShape.trayRect.x + slideOffset,
      y: shipShape.trayRect.y,
      w: shipShape.trayRect.w,
      h: shipShape.trayRect.h,
    };
  }

  const shipShape = {
    hullPoints: [
      { x: 0, y: -0.9 }, { x: 0.9, y: -0.35 }, { x: 0.95, y: 0.25 },
      { x: 0.5, y: 0.55 }, { x: -0.5, y: 0.55 }, { x: -0.95, y: 0.25 },
      { x: -0.9, y: -0.35 }
    ],
    hullRadius: 0.95,
    skidL: { x: -0.45, y: 0.78 },
    skidR: { x: 0.45, y: 0.78 },
    thruster: { x: 0, y: 0.58 },
    trayRect: { x: -2.15, y: -0.45, w: 1.65, h: 0.9 },
    craneBase: { x: 0, y: -0.92 },
  };

  const cargoTypes = [
    { name: 'small', r: 0.14, mass: 0.17, points: 50, color: '#9baec7' },
    { name: 'medium', r: 0.19, mass: 0.3, points: 100, color: '#88a0b9' },
    { name: 'large', r: 0.26, mass: 0.46, points: 200, color: '#c2a96e' },
  ];

  const cargoShapes = ['rectangle', 'triangle', 'circle', 'trapezoid', 'diamond', 'hex'];

  let cargos = [];
  let nextCargoId = 0;

  function createCargoPiece(x, y, type, hue, shapeIndex = 0) {
    return {
      id: `c${nextCargoId++}`,
      x, y,
      vx: 0,
      vy: 0,
      angle: Math.random() * Math.PI,
      av: 0,
      r: type.r,
      mass: type.mass,
      points: type.points,
      color: `hsl(${hue} 68% 68%)`,
      accent: `hsl(${(hue + 180) % 360} 78% 36%)`,
      type: type.name,
      shape: cargoShapes[shapeIndex % cargoShapes.length],
      grabbed: false,
      stored: false,
      scored: false,
      accepting: false,
      acceptedTimer: 0,
      targetX: 0,
      targetY: 0,
      restTimer: 0,
      localPos: { x: 0, y: 0 },
      popDelay: 0,
      popping: false,
      ignoreTrayTimer: 0,
      recyclePadX: 0,
      recyclePadW: 0,
      recycleLockTimer: 0,
    };
  }
  function xOverlapsAnyPad(x, radius = 0) {
    return terrain.pads.some((pad) => {
      const half = pad.w * 0.5;
      return x + radius > pad.x - half && x - radius < pad.x + half;
    });
  }

  function spawnCargo() {
    cargos = [];
    nextCargoId = 0;
    for (let i = 0; i < CONFIG.cargoCount; i++) {
      const type = cargoTypes[Math.floor(Math.random() * cargoTypes.length)];
      let x = 20 + Math.random() * (CONFIG.worldWidth - 30);
      let attempts = 0;
      while (xOverlapsAnyPad(x, type.r + 0.25) && attempts < 80) {
        x = 20 + Math.random() * (CONFIG.worldWidth - 30);
        attempts += 1;
      }

      if (xOverlapsAnyPad(x, type.r + 0.25)) {
        const fallback = terrain.pads
          .map((pad) => [pad.x - pad.w * 0.5 - type.r - 0.35, pad.x + pad.w * 0.5 + type.r + 0.35])
          .flat()
          .map((candidate) => clamp(candidate, 20 + type.r, CONFIG.worldWidth - 10 - type.r))
          .find((candidate) => !xOverlapsAnyPad(candidate, type.r + 0.25));
        if (typeof fallback === 'number') x = fallback;
      }

      const y = terrainY(x) - type.r - Math.random() * 0.35;
      const hue = Math.floor((i * 37 + Math.random() * 25) % 360);
      cargos.push(createCargoPiece(x, y, type, hue, i));
    }
  }
  spawnCargo();

  const game = {
    score: 0,
    showHelp: false,
    paused: false,
    state: 'READY',
    camera: { x: ship.x, y: ship.y - 6 },
    explosions: [],
    crunchFx: [],
    audio: null,
    supplyShips: [],
    supplySpawnTimer: CONFIG.supplyShipIntervalSec,
  };




  function pickDropXAvoidPads(preferredX, radius, margin = 0.55) {
    const clamped = clamp(preferredX, 2 + radius, CONFIG.worldWidth - 2 - radius);
    if (!xOverlapsAnyPad(clamped, radius + margin)) return clamped;

    for (let i = 0; i < 50; i++) {
      const candidate = 4 + Math.random() * (CONFIG.worldWidth - 8);
      const safe = clamp(candidate, 2 + radius, CONFIG.worldWidth - 2 - radius);
      if (!xOverlapsAnyPad(safe, radius + margin)) return safe;
    }
    return clamped;
  }

  function dropCargoFromSupplyShip(x, y) {
    const type = cargoTypes[Math.floor(Math.random() * cargoTypes.length)];
    const safeX = pickDropXAvoidPads(x, type.r);
    const hue = Math.floor(Math.random() * 360);
    const piece = createCargoPiece(safeX, y, type, hue, Math.floor(Math.random() * cargoShapes.length));
    piece.vx = (Math.random() - 0.5) * 0.8;
    piece.vy = 0.2 + Math.random() * 0.9;
    piece.angle = Math.random() * Math.PI * 2;
    cargos.push(piece);
  }


  function spawnSupplyShip() {
    const dir = Math.random() < 0.5 ? 1 : -1;
    const tm = terrainMetrics();
    const y = tm.minY - (4.8 + Math.random() * 4.5);
    const startX = dir > 0 ? -10 : CONFIG.worldWidth + 10;
    const endX = dir > 0 ? CONFIG.worldWidth + 12 : -12;
    const speed = 6.3 + Math.random() * 2.2;

    const viewW = W / CONFIG.METER_TO_PX;
    const onScreenDrop = pickDropXAvoidPads(game.camera.x + (Math.random() - 0.5) * viewW * 0.35, 0.26);
    const drops = [onScreenDrop];
    while (drops.length < CONFIG.supplyDropsPerShip) {
      const candidate = pickDropXAvoidPads(8 + Math.random() * (CONFIG.worldWidth - 16), 0.26);
      if (drops.every((x) => Math.abs(x - candidate) > 6.5)) drops.push(candidate);
    }
    drops.sort((a, b) => dir > 0 ? a - b : b - a);

    game.supplyShips.push({ x: startX, y, dir, speed, endX, drops, dropped: 0 });
  }

  function updateSupplyShips(dt) {
    if (game.state !== 'PLAYING') return;

    game.supplySpawnTimer -= dt;
    if (game.supplySpawnTimer <= 0) {
      spawnSupplyShip();
      game.supplySpawnTimer += CONFIG.supplyShipIntervalSec;
    }

    for (const craft of game.supplyShips) {
      craft.x += craft.dir * craft.speed * dt;
      while (craft.dropped < craft.drops.length) {
        const targetX = craft.drops[craft.dropped];
        const reached = craft.dir > 0 ? craft.x >= targetX : craft.x <= targetX;
        if (!reached) break;
        dropCargoFromSupplyShip(targetX, craft.y + 0.5);
        craft.dropped += 1;
      }
    }

    game.supplyShips = game.supplyShips.filter((craft) => {
      const pastEnd = craft.dir > 0 ? craft.x < craft.endX : craft.x > craft.endX;
      return pastEnd || craft.dropped < craft.drops.length;
    });
  }

  function drawSupplyShips() {
    for (const craft of game.supplyShips) {
      const s = toScreen(craft.x, craft.y);
      if (s.x < -60 || s.x > W + 60 || s.y < -40 || s.y > getGameplayHeight() + 20) continue;

      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.scale(craft.dir, 1);
      ctx.fillStyle = '#b8c4d7';
      ctx.beginPath();
      ctx.ellipse(0, 0, 24, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#6f7f96';
      ctx.fillRect(-16, -2, 20, 4);
      ctx.fillStyle = '#9ce8ff';
      ctx.fillRect(5, -1, 12, 2);
      ctx.restore();
    }
  }

  function randomizeWorld() {
    terrain = generateTerrain();
    regenerateStars();
    spawnCargo();
    game.supplyShips = [];
    game.supplySpawnTimer = CONFIG.supplyShipIntervalSec;
  }

  function startMission() {
    game.score = 0;
    game.explosions = [];
    game.crunchFx = [];
    ship.grabbedCargo = null;
    ship.storedCargoIds = [];
    ship.cargoMass = 0;
    ship.throttle = 0;
    ship.fuel = 100;
    ship.baseAngle = 0;
    ship.seg1Angle = 2.9;
    ship.seg2Angle = 3.05;
    ship.clawOpen = 1;
    ship.bounceCount = 0;
    ship.settleLock = false;
    ship.invincibleTimer = 0;
    ship.trayExtended = true;
    ship.traySlide = 1;
    ship.tracksExtended = false;
    ship.tracksDeploy = 0;
    ship.gearExtended = true;
    ship.gearDeploy = 1;
    ship.gearSafetyTimer = 0;
    ship.angle = 0;
    ship.av = 0;
    randomizeWorld();
    shipSpawn.y = terrainY(shipSpawn.x) - shipShape.skidL.y;
    ship.x = shipSpawn.x;
    ship.y = shipSpawn.y;
    setShipOnGround();
    game.camera.x = ship.x;
    game.camera.y = ship.y - 6;
    game.state = 'PLAYING';
    game.showHelp = false;
    initAudio();
  }

  function setShipOnGround() {
    const supportLocals = getSupportLocals();
    const supportLLocal = supportLocals.left;
    const supportRLocal = supportLocals.right;
    const skidL = worldFromLocal(ship, supportLLocal);
    const skidR = worldFromLocal(ship, supportRLocal);
    const gyL = terrainY(skidL.x);
    const gyR = terrainY(skidR.x);
    ship.y += Math.min(gyL - skidL.y, gyR - skidR.y);
    ship.vx = 0;
    ship.vy = 0;
    ship.av = 0;
    ship.landed = true;
  }

  function distanceToGroundMeters() {
    const supportLocals = getSupportLocals();
    const supportLLocal = supportLocals.left;
    const supportRLocal = supportLocals.right;
    const skidL = worldFromLocal(ship, supportLLocal);
    const skidR = worldFromLocal(ship, supportRLocal);
    const dL = terrainY(skidL.x) - skidL.y;
    const dR = terrainY(skidR.x) - skidR.y;
    return Math.max(0, Math.min(dL, dR));
  }

  function initAudio() {
    if (game.audio) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctxA = new Ctx();

    const master = ctxA.createGain();
    master.gain.value = 0.24;
    master.connect(ctxA.destination);

    const rumbleGain = ctxA.createGain();
    rumbleGain.gain.value = 0;
    const rumble = ctxA.createOscillator();
    rumble.type = 'sawtooth';
    rumble.frequency.value = 62;
    rumble.connect(rumbleGain);
    rumbleGain.connect(master);
    rumble.start();

    const rocketToneGain = ctxA.createGain();
    rocketToneGain.gain.value = 0;
    const rocketTone = ctxA.createOscillator();
    rocketTone.type = 'triangle';
    rocketTone.frequency.value = 120;
    const rocketFilter = ctxA.createBiquadFilter();
    rocketFilter.type = 'bandpass';
    rocketFilter.frequency.value = 260;
    rocketFilter.Q.value = 1.8;
    rocketTone.connect(rocketFilter);
    rocketFilter.connect(rocketToneGain);
    rocketToneGain.connect(master);
    rocketTone.start();

    const hydroGain = ctxA.createGain();
    hydroGain.gain.value = 0;
    const hydro = ctxA.createOscillator();
    hydro.type = 'sawtooth';
    hydro.frequency.value = 145;
    const hydroFilter = ctxA.createBiquadFilter();
    hydroFilter.type = 'bandpass';
    hydroFilter.frequency.value = 420;
    hydroFilter.Q.value = 3;
    hydro.connect(hydroFilter);
    hydroFilter.connect(hydroGain);
    hydroGain.connect(master);
    hydro.start();

    game.audio = {
      ctx: ctxA,
      master,
      rumble,
      rumbleGain,
      rocketTone,
      rocketToneGain,
      hydro,
      hydroGain,
    };
  }

  function updateAudio() {
    const a = game.audio;
    if (!a) return;
    const t = a.ctx.currentTime;

    if (a.ctx.state === 'suspended' && game.state === 'PLAYING') a.ctx.resume();

    const playing = game.state === 'PLAYING' && !game.paused;

    const armMoving = keys.has('KeyI') || keys.has('KeyO') ||
      keys.has('KeyN') || keys.has('KeyM') ||
      keys.has('KeyK') || keys.has('KeyL') ||
      keys.has('Comma') || keys.has('Period');

    const targetRumble = playing ? Math.max(0, ship.throttle) * 0.1352 : 0;
    a.rumbleGain.gain.setTargetAtTime(targetRumble, t, 0.05);
    a.rumble.frequency.setTargetAtTime(52 + ship.throttle * 35, t, 0.05);

    const targetRocketTone = playing ? Math.max(0, ship.throttle) * 0.0845 : 0;
    a.rocketToneGain.gain.setTargetAtTime(targetRocketTone, t, 0.04);
    a.rocketTone.frequency.setTargetAtTime(95 + ship.throttle * 120, t, 0.05);

    const targetHydro = (playing && armMoving) ? 0.09295 : 0;
    a.hydroGain.gain.setTargetAtTime(targetHydro, t, 0.02);
    a.hydro.frequency.setTargetAtTime(180 + Math.abs(Math.sin(t * 18)) * 180, t, 0.015);

    a.master.gain.setTargetAtTime(playing ? 0.24 : 0.1, t, 0.08);
  }

  randomizeWorld();
  shipSpawn.y = terrainY(shipSpawn.x) - shipShape.skidL.y;
  ship.x = shipSpawn.x;
  ship.y = shipSpawn.y;
  setShipOnGround();
  game.camera.x = ship.x;
  game.camera.y = ship.y - 6;

  function getArmKinematics() {
    const base = worldFromLocal(ship, shipShape.craneBase);
    const shipUpAngle = ship.angle - Math.PI / 2;
    const a0 = shipUpAngle + ship.baseAngle;
    const seg1Len = 2.14;
    const seg2Len = 1.91;
    const p1 = { x: base.x + Math.cos(a0) * seg1Len, y: base.y + Math.sin(a0) * seg1Len };
    const a1 = a0 + (ship.seg1Angle - Math.PI / 2);
    const p2 = { x: p1.x + Math.cos(a1) * seg2Len, y: p1.y + Math.sin(a1) * seg2Len };
    const a2 = a1 + (ship.seg2Angle - Math.PI / 2);
    const clawLen = 0.28;
    const tip = { x: p2.x + Math.cos(a2) * clawLen, y: p2.y + Math.sin(a2) * clawLen };
    return { base, p1, p2, tip, a2 };
  }

  function crashShip(reason) {
    if (game.state === 'CRASHED') return;
    game.state = 'CRASHED';
    ship.crashTimer = CONFIG.respawnSeconds;
    ship.landed = false;
    ship.grabbedCargo = null;
    ship.bounceCount = 0;
    ship.settleLock = false;

    for (let i = 0; i < 28; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 6;
      game.explosions.push({
        x: ship.x,
        y: ship.y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 1,
      });
    }

    // Drop all tray cargo on crash.
    for (const id of ship.storedCargoIds) {
      const c = cargos.find(k => k.id === id);
      if (!c || c.scored) continue;
      c.stored = false;
      c.grabbed = false;
      c.vx = ship.vx + (Math.random() - 0.5) * 3;
      c.vy = ship.vy - Math.random() * 2;
    }
    ship.storedCargoIds = [];
    ship.cargoMass = 0;
    // eslint-disable-next-line no-console
    console.info('Crash:', reason);
  }

  function respawnShip() {
    ship.x = shipSpawn.x;
    ship.y = shipSpawn.y;
    ship.vx = 0;
    ship.vy = 0;
    ship.angle = 0;
    ship.av = 0;
    ship.throttle = 0;
    ship.fuel = 100;
    ship.landed = true;
    ship.baseAngle = 0;
    ship.seg1Angle = 2.9;
    ship.seg2Angle = 3.05;
    ship.clawOpen = 1;
    ship.grabbedCargo = null;
    ship.storedCargoIds = [];
    ship.cargoMass = 0;
    ship.bounceCount = 0;
    ship.settleLock = false;
    ship.invincibleTimer = 0;
    ship.trayExtended = false;
    ship.traySlide = 0;
    ship.tracksExtended = false;
    ship.tracksDeploy = 0;
    ship.gearExtended = false;
    ship.gearDeploy = 0;
    ship.gearSafetyTimer = 0;
    setShipOnGround();
    game.camera.x = ship.x;
    game.camera.y = ship.y - 6;
    game.state = 'READY';
    game.showHelp = false;
  }

  function updateInput(dt) {
    const tracksLock = ship.tracksExtended || ship.tracksDeploy > 0.05;
    const tracksDriving = ship.tracksDeploy > 0.6 && ship.landed;

    if (tracksDriving) {
      ship.throttle = 0;
      if (keys.has('KeyA')) ship.vx -= CONFIG.trackDriveAccel * dt;
      if (keys.has('KeyD')) ship.vx += CONFIG.trackDriveAccel * dt;
      ship.vx = clamp(ship.vx, -CONFIG.trackDriveMaxSpeed, CONFIG.trackDriveMaxSpeed);
      ship.av *= 0.75;
    } else if (!tracksLock) {
      if (keys.has('KeyA')) ship.av -= CONFIG.torqueAccel * dt;
      if (keys.has('KeyD')) ship.av += CONFIG.torqueAccel * dt;

      if (keys.has('KeyW')) ship.throttle = clamp(ship.throttle + CONFIG.throttleRampPerSec * dt, 0, 1);
      if (keys.has('KeyS')) ship.throttle = clamp(ship.throttle - CONFIG.throttleRampPerSec * dt, 0, 1);
    } else {
      ship.throttle = 0;
    }

    if (keys.has('KeyK')) ship.baseAngle -= CONFIG.baseRate * dt;
    if (keys.has('KeyL')) ship.baseAngle += CONFIG.baseRate * dt;
    if (keys.has('KeyI')) ship.seg1Angle -= CONFIG.seg1Rate * dt;
    if (keys.has('KeyO')) ship.seg1Angle += CONFIG.seg1Rate * dt;
    if (keys.has('KeyN')) ship.seg2Angle -= CONFIG.seg2Rate * dt;
    if (keys.has('KeyM')) ship.seg2Angle += CONFIG.seg2Rate * dt;
    if (keys.has('Comma')) ship.clawOpen = clamp(ship.clawOpen - CONFIG.clawRate * dt, 0, 1);
    if (keys.has('Period')) ship.clawOpen = clamp(ship.clawOpen + CONFIG.clawRate * dt, 0, 1);

    ship.baseAngle = clamp(ship.baseAngle, -120 * Math.PI/180, 120 * Math.PI/180);
    // Segment joints are intentionally unbounded for full 360° continuous control.

  }

  function updateShip(dt) {
    ship.invincibleTimer = Math.max(0, ship.invincibleTimer - dt);
    ship.gearSafetyTimer = Math.max(0, ship.gearSafetyTimer - dt);
    if (ship.tracksExtended && ship.gearExtended) ship.gearExtended = false;
    const swapToTracks = ship.tracksExtended;
    const modeTransitionActive = swapToTracks
      ? (ship.gearDeploy > 0.001 || ship.tracksDeploy < 0.999)
      : (ship.tracksDeploy > 0.001);

    const swapRate = CONFIG.trackDeployRate * (modeTransitionActive ? 0.5 : 1);
    if (swapToTracks) {
      // Entering vehicle mode sequence: gear retracts first, then tracks extend.
      const gearStepDone = ship.gearDeploy <= 0.02;
      ship.gearDeploy = moveTowards(ship.gearDeploy, 0, dt / CONFIG.landingGearTransitionSec);
      if (gearStepDone) ship.tracksDeploy = lerp(ship.tracksDeploy, 1, clamp(swapRate * dt, 0, 1));
      else ship.tracksDeploy = lerp(ship.tracksDeploy, 0, clamp(swapRate * dt, 0, 1));
    } else {
      // Exiting vehicle mode sequence: tracks retract first, then gear follows manual target.
      const trackStepDone = ship.tracksDeploy <= 0.02;
      ship.tracksDeploy = lerp(ship.tracksDeploy, 0, clamp(swapRate * dt, 0, 1));
      if (trackStepDone) ship.gearDeploy = moveTowards(ship.gearDeploy, ship.gearExtended ? 1 : 0, dt / CONFIG.landingGearTransitionSec);
      else ship.gearDeploy = moveTowards(ship.gearDeploy, 0, dt / CONFIG.landingGearTransitionSec);
    }

    // Manual gear toggle outside track mode.
    if (!modeTransitionActive && !ship.tracksExtended) {
      ship.gearDeploy = moveTowards(ship.gearDeploy, ship.gearExtended ? 1 : 0, dt / CONFIG.landingGearTransitionSec);
    }

    // Ensure transitions fully complete (avoid asymptotic lingering).
    if (Math.abs(ship.tracksDeploy - (ship.tracksExtended ? 1 : 0)) < 0.001) ship.tracksDeploy = ship.tracksExtended ? 1 : 0;
    if (!ship.tracksExtended && Math.abs(ship.gearDeploy - (ship.gearExtended ? 1 : 0)) < 0.001) ship.gearDeploy = ship.gearExtended ? 1 : 0;
    if (ship.tracksExtended && Math.abs(ship.gearDeploy) < 0.001) ship.gearDeploy = 0;

    const recyclePadUnderShip = terrain.pads.find((p) => p.kind === 'recycle' && Math.abs(ship.x - p.x) <= p.w * 0.45);
    if (ship.landed && recyclePadUnderShip) {
      ship.invincibleTimer = Math.max(ship.invincibleTimer, 0.2);
    }
    const trayTarget = ship.trayExtended ? 1 : 0;
    ship.traySlide = lerp(ship.traySlide, trayTarget, clamp(8 * dt, 0, 1));
    const mass = shipMass();

    const flying = !ship.landed || ship.throttle > 0.02 || Math.hypot(ship.vx, ship.vy) > 0.4;
    if (flying) {
      const m = terrainMetrics();
      const highAltitudeThreshold = m.minY - (m.height * 2);
      const highAltitudeMultiplier = ship.y < highAltitudeThreshold ? 1.5 : 1;
      const burn = (CONFIG.fuelBurnBase + CONFIG.fuelBurnByThrottle * ship.throttle) * highAltitudeMultiplier * dt;
      ship.fuel = clamp(ship.fuel - burn, 0, 100);
    }

    const tracksLock = ship.tracksExtended || ship.tracksDeploy > 0.05;
    const tracksDriving = ship.tracksDeploy > 0.6;
    let thrust = 0;
    if (!tracksLock && ship.fuel > 0) thrust = CONFIG.thrustMax * ship.throttle;
    if (tracksLock) ship.throttle = 0;

    const thrustDir = rotate({ x: 0, y: -1 }, ship.angle);
    ship.vx += (thrustDir.x * thrust / mass) * dt;
    ship.vy += (CONFIG.gravity + thrustDir.y * thrust / mass) * dt;

    ship.vx *= Math.exp(-CONFIG.linearDamping * dt);
    ship.vy *= Math.exp(-CONFIG.linearDamping * dt);
    ship.av *= Math.exp(-CONFIG.angularDamping * dt);

    ship.angle += ship.av * dt;
    ship.x += ship.vx * dt;
    ship.y += ship.vy * dt;

    const horizontalMargin = shipShape.hullRadius;
    const leftWall = horizontalMargin;
    const rightWall = CONFIG.worldWidth - horizontalMargin;
    ship.x = clamp(ship.x, leftWall, rightWall);
    const wallEpsilon = 1e-4;
    const atLeftWall = ship.x <= leftWall + wallEpsilon;
    const atRightWall = ship.x >= rightWall - wallEpsilon;
    if (atLeftWall && ship.vx < 0) ship.vx = 0;
    if (atRightWall && ship.vx > 0) ship.vx = 0;

    // Stop at altitude/world edges to prevent off-screen glitch behavior.
    const tm = terrainMetrics();
    const topStop = tm.minY - tm.height * 2.2;
    const bottomStop = tm.maxY + 1.5;
    if (ship.y < topStop) {
      ship.y = topStop;
      if (ship.vy < 0) ship.vy = 0;
    }
    if (ship.y > bottomStop) {
      ship.y = bottomStop;
      if (ship.vy > 0) ship.vy = 0;
    }

    const supportLocals = getSupportLocals();
    const supportLLocal = supportLocals.left;
    const supportRLocal = supportLocals.right;
    const skidL = worldFromLocal(ship, supportLLocal);
    const skidR = worldFromLocal(ship, supportRLocal);
    const hullCenter = { x: ship.x, y: ship.y };

    if (ship.invincibleTimer <= 0) {
      for (const c of cargos) {
        if (c.scored || c.accepting || c.stored || c.grabbed || c.popping) continue;
        if (Math.hypot(c.x - hullCenter.x, c.y - hullCenter.y) < c.r + shipShape.hullRadius * (0.8 / CONFIG.impactRobustness)) {
          return crashShip('hull-cargo');
        }
      }
    }

    const skidLInBounds = skidL.x >= 0 && skidL.x <= CONFIG.worldWidth;
    const skidRInBounds = skidR.x >= 0 && skidR.x <= CONFIG.worldWidth;
    const trackContactPad = tracksDriving ? 0.12 : 0;
    const skidLContact = skidLInBounds && (skidL.y + trackContactPad) >= terrainY(skidL.x);
    const skidRContact = skidRInBounds && (skidR.y + trackContactPad) >= terrainY(skidR.x);

    if (tracksDriving) {
      const gxL = clamp(ship.x + shipShape.skidL.x, 0, CONFIG.worldWidth);
      const gxR = clamp(ship.x + shipShape.skidR.x, 0, CONFIG.worldWidth);
      const gyL = terrainY(gxL);
      const gyR = terrainY(gxR);
      const slopeAngle = Math.atan2(gyR - gyL, Math.max(0.001, gxR - gxL));
      ship.angle = lerp(ship.angle, slopeAngle, clamp(8 * dt, 0, 1));

      const uphillSign = Math.sign(ship.vx) * Math.sign(gyR - gyL);
      const slopeFactor = uphillSign > 0 ? 0.85 : (uphillSign < 0 ? 1.15 : 1);
      const slopeAdjustedVx = ship.vx * slopeFactor;
      ship.vx = lerp(ship.vx, slopeAdjustedVx, clamp(2 * dt, 0, 1));
      ship.vx = clamp(ship.vx, -CONFIG.trackDriveMaxSpeed * 1.15, CONFIG.trackDriveMaxSpeed * 1.15);
    }

    const angleOk = Math.abs(ship.angle) < CONFIG.landingMaxAngleDeg * Math.PI / 180;
    const speed = Math.hypot(ship.vx, ship.vy);
    const verticalOk = Math.abs(ship.vy) < CONFIG.landingMaxVY;
    const speedOk = speed < CONFIG.landingMaxSpeed;

    const hasSkid = skidLContact || skidRContact;
    if (!hasSkid) {
      ship.bounceCount = 0;
      ship.settleLock = false;
    }

    const supportSwapActive = (ship.tracksExtended && (ship.gearDeploy > 0.02 || ship.tracksDeploy < 0.98))
      || (!ship.tracksExtended && (ship.tracksDeploy > 0.02 || ship.gearDeploy < 0.98));
    if (hasSkid && !tracksDriving && !supportSwapActive && ship.gearSafetyTimer <= 0 && ship.gearDeploy < 0.85) {
      return crashShip('no-landing-gear');
    }

    if (hasSkid && !angleOk && !tracksDriving) {
      return crashShip('bad-landing');
    }

    if (hasSkid && angleOk && Math.abs(ship.vy) > CONFIG.landingMaxVY && Math.abs(ship.vy) <= CONFIG.landingBounceVY) {
      if (ship.bounceCount < CONFIG.landingSettleBounces) {
        ship.vy = -Math.abs(ship.vy) * (0.24 - ship.bounceCount * 0.05);
        ship.vx *= 0.84;
        ship.av *= 0.72;
        ship.bounceCount += 1;
      } else {
        ship.settleLock = true;
        ship.vy = 0;
        ship.vx *= 0.6;
        ship.av *= 0.45;
      }
    }

    if (!tracksDriving && hasSkid && Math.abs(ship.vy) > CONFIG.landingCrashVY * CONFIG.impactRobustness) return crashShip('hard-impact');

    let hullHitTerrain = false;
    let hullPenetration = 0;
    for (const p of shipShape.hullPoints) {
      const w = worldFromLocal(ship, p);
      if (w.x < 0 || w.x > CONFIG.worldWidth) continue;
      const surfaceY = terrainY(w.x) - 0.02;
      if (w.y > surfaceY) {
        hullHitTerrain = true;
        hullPenetration = Math.max(hullPenetration, w.y - surfaceY);
      }
    }

    if (hullHitTerrain && hullPenetration > 0) {
      // Never allow the hull to remain below terrain surface.
      ship.y -= hullPenetration;
    }

    if (!tracksDriving && hullHitTerrain && !hasSkid) {
      const crashV = CONFIG.landingMaxVY * CONFIG.impactRobustness;
      const crashSpeed = CONFIG.landingMaxSpeed * CONFIG.impactRobustness;
      if (Math.abs(ship.vy) > crashV || speed > crashSpeed) return crashShip('hull-terrain');

      // Slow collision into terrain resolves as a forced settle/landing.
      ship.vy = 0;
      ship.vx *= 0.7;
      ship.av *= 0.5;
      ship.settleLock = true;
    }

    ship.landed = (tracksDriving && hasSkid) || (hasSkid && angleOk && speedOk && (verticalOk || ship.settleLock)) || (!tracksDriving && hullHitTerrain && speed < CONFIG.landingMaxSpeed * CONFIG.impactRobustness);
    if (tracksDriving && ship.landed) {
      ship.angle = lerp(ship.angle, 0, clamp(8 * dt, 0, 1));
      ship.av *= 0.4;
    }
    if (ship.landed) {
      const landingRecyclePad = terrain.pads.find((p) => p.kind === 'recycle' && Math.abs(ship.x - p.x) <= p.w * 0.45);
      if (landingRecyclePad) ship.invincibleTimer = Math.max(ship.invincibleTimer, 0.2);
      ship.vy = Math.min(ship.vy, 0);
      ship.bounceCount = 0;
      ship.settleLock = true;
      if (tracksDriving) {
        ship.vy = 0;
        ship.vx *= 0.985;
        ship.av *= 0.25;
      } else {
        ship.vx *= 0.93;
        ship.av *= 0.85;
      }
      const ground = Math.min(terrainY(skidL.x) - supportLLocal.y, terrainY(skidR.x) - supportRLocal.y);
      ship.y = tracksDriving ? ground : Math.min(ship.y, ground);
    }

    // Refuel only with safe skid landing on refuel pad.
    if (ship.landed) {
      const refuel = terrain.pads.find(p => p.kind === 'refuel' && Math.abs(ship.x - p.x) <= p.w * 0.45);
      if (refuel) ship.fuel = clamp(ship.fuel + 100 * dt, 0, 100);
    }
  }

  function updateCargo(dt) {
    const arm = getArmKinematics();

    if (ship.grabbedCargo) {
      const c = cargos.find(k => k.id === ship.grabbedCargo);
      if (c) {
        c.grabbed = true;
        c.stored = false;
        c.x = arm.tip.x;
        c.y = arm.tip.y;
        c.vx = ship.vx;
        c.vy = ship.vy;
      }

      if (ship.clawOpen > 0.82) {
        if (c) c.grabbed = false;
        ship.grabbedCargo = null;
      }
    } else {
      // Pick when claw is mostly closed and target near tip.
      if (ship.clawOpen < 0.2) {
        let pick = null;
        let best = 0.45;
        for (const c of cargos) {
          if (c.scored || c.stored || c.grabbed) continue;
          const d = Math.hypot(c.x - arm.tip.x, c.y - arm.tip.y);
          if (d < best + c.r) {
            best = d;
            pick = c;
          }
        }
        if (pick) {
          pick.grabbed = true;
          ship.grabbedCargo = pick.id;
        }
      }
    }

    // Recycle-pad ejection behavior: cargo pops out but is guided to land and remain on the pad.
    const shipUpDir = rotate({ x: 0, y: -1 }, ship.angle);
    for (const c of cargos) {
      if (c.ignoreTrayTimer > 0) c.ignoreTrayTimer = Math.max(0, c.ignoreTrayTimer - dt);
      if (c.recycleLockTimer > 0) c.recycleLockTimer = Math.max(0, c.recycleLockTimer - dt);
      if (!c.popping) continue;
      c.popDelay -= dt;
      if (c.popDelay <= 0) {
        c.popping = false;
        const padLeft = c.recyclePadX - c.recyclePadW * 0.42;
        const padRight = c.recyclePadX + c.recyclePadW * 0.42;
        const goalX = clamp(c.targetX || c.recyclePadX, padLeft + c.r, padRight - c.r);
        const dx = goalX - c.x;
        c.vx = ship.vx + clamp(dx * 2.4, -1.15, 1.15);
        c.vy = ship.vy + shipUpDir.y * 0.9 - 1.0;
      } else {
        const trLip = getTrayRect();
        const backLip = worldFromLocal(ship, { x: trLip.x - 0.15, y: trLip.y + trLip.h * 0.55 });
        c.x = backLip.x;
        c.y = backLip.y;
        c.vx = ship.vx;
        c.vy = ship.vy;
      }
    }

    // Gravity + collision for free cargo
    for (const c of cargos) {
      if (c.scored || c.accepting || c.stored || c.grabbed || c.popping) continue;
      c.vy += CONFIG.gravity * dt;
      c.vx *= 0.995;
      c.vy *= 0.995;
      c.av *= 0.99;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.angle += c.av * dt;

      c.x = clamp(c.x, c.r, CONFIG.worldWidth - c.r);
      if (c.recycleLockTimer > 0 && c.recyclePadW > 0) {
        const padLeft = c.recyclePadX - c.recyclePadW * 0.42 + c.r;
        const padRight = c.recyclePadX + c.recyclePadW * 0.42 - c.r;
        c.x = clamp(c.x, padLeft, padRight);
        c.vx *= 0.65;
      }
      const gy = terrainY(c.x) - c.r;
      if (c.y > gy) {
        c.y = gy;
        if (Math.abs(c.vy) > 0.3) c.vy *= -0.22;
        else c.vy = 0;
        c.vx *= 0.88;
        if (c.recycleLockTimer > 0 && c.recyclePadW > 0) {
          const padLeft = c.recyclePadX - c.recyclePadW * 0.42 + c.r;
          const padRight = c.recyclePadX + c.recyclePadW * 0.42 - c.r;
          c.x = clamp(c.x, padLeft, padRight);
          c.vx = 0;
          if (Math.abs(c.vy) < 0.35) c.vy = 0;
        }
      }

      const speed = Math.hypot(c.vx, c.vy);
      if (speed < 0.2) c.restTimer += dt;
      else c.restTimer = 0;
    }

    // Tray catch: dropped/free cargo that enters tray bounds is caught and stored.
    if (ship.traySlide > 0.55) for (const c of cargos) {
      if (c.scored || c.accepting || c.stored || c.grabbed || c.popping || c.ignoreTrayTimer > 0) continue;
      const local = rotate({ x: c.x - ship.x, y: c.y - ship.y }, -ship.angle);
      const tr = getTrayRect();
      const inTray = local.x > tr.x + c.r && local.x < tr.x + tr.w - c.r && local.y > tr.y + c.r && local.y < tr.y + tr.h - c.r;
      if (!inTray) continue;
      c.stored = true;
      c.vx = ship.vx;
      c.vy = ship.vy;
      c.localPos = { x: clamp(local.x, tr.x + c.r, tr.x + tr.w - c.r), y: clamp(local.y, tr.y + c.r, tr.y + tr.h - c.r) };
      if (!ship.storedCargoIds.includes(c.id)) {
        ship.storedCargoIds.push(c.id);
        ship.cargoMass += c.mass;
      }
    }

    // Tray storage: if grabbed cargo is lowered into tray and ship is landed/slow, snap store.
    if (ship.grabbedCargo && ship.traySlide > 0.55) {
      const c = cargos.find(k => k.id === ship.grabbedCargo);
      if (c) {
        const local = rotate({ x: c.x - ship.x, y: c.y - ship.y }, -ship.angle);
        const tr = getTrayRect();
        const inTray = local.x > tr.x && local.x < tr.x + tr.w && local.y > tr.y && local.y < tr.y + tr.h;
        const slow = Math.hypot(ship.vx, ship.vy) < 1.0;
        if (inTray && (ship.landed || slow)) {
          c.grabbed = false;
          c.stored = true;
          c.localPos = { x: clamp(local.x, tr.x + c.r, tr.x + tr.w - c.r), y: clamp(local.y, tr.y + c.r, tr.y + tr.h - c.r) };
          ship.grabbedCargo = null;
          if (!ship.storedCargoIds.includes(c.id)) {
            ship.storedCargoIds.push(c.id);
            ship.cargoMass += c.mass;
          }
        }
      }
    }

    for (const id of ship.storedCargoIds) {
      const c = cargos.find(k => k.id === id);
      if (!c || c.scored || c.accepting) continue;
      const w = worldFromLocal(ship, c.localPos);
      c.x = w.x;
      c.y = w.y;
      c.vx = ship.vx;
      c.vy = ship.vy;
    }

    // Delivery: when safely landed on recycle pad, unload tray cargo by popping out of tray back.
    if (ship.landed) {
      const pad = terrain.pads.find(p => p.kind === 'recycle' && Math.abs(ship.x - p.x) <= p.w * 0.5);
      const trayOpenForUnload = ship.trayExtended && ship.traySlide > 0.8;
      if (pad && trayOpenForUnload && ship.storedCargoIds.length > 0) {
        const ids = [...ship.storedCargoIds];
        ship.storedCargoIds = [];
        ship.cargoMass = 0;
        ship.invincibleTimer = Math.max(ship.invincibleTimer, 2.2);
        ids.forEach((id, i) => {
          const c = cargos.find(k => k.id === id);
          if (!c || c.scored || c.accepting) return;
          c.stored = false;
          c.grabbed = false;
          const trLip = getTrayRect();
          const backLip = worldFromLocal(ship, { x: trLip.x - 0.15, y: trLip.y + trLip.h * 0.55 });
          const slot = (i + 1) / (ids.length + 1);
          c.targetX = pad.x - pad.w * 0.34 + slot * (pad.w * 0.68);
          c.recyclePadX = pad.x;
          c.recyclePadW = pad.w;
          c.recycleLockTimer = 3.5;
          c.x = backLip.x;
          c.y = backLip.y;
          c.vx = ship.vx;
          c.vy = ship.vy;
          c.restTimer = 0;
          c.popping = true;
          c.popDelay = i * 0.07;
          c.ignoreTrayTimer = 1.0;
        });
      }
    }

    // Score when released cargo rests inside drop zone.
    for (const c of cargos) {
      if (c.scored || c.accepting || c.stored || c.grabbed) continue;
      const pad = terrain.pads.find(p => p.kind === 'recycle' && Math.abs(c.x - p.x) < p.w * 0.45 && c.y + c.r > p.y - 0.1);
      if (pad && c.restTimer > 0.45) {
        c.accepting = true;
        c.acceptedTimer = 0.9;
        c.targetX = pad.x + pad.w * 0.36;
        c.targetY = pad.y - 0.65;
        game.score += c.points;
      }
    }

    for (const c of cargos) {
      if (!c.accepting || c.scored) continue;
      c.acceptedTimer -= dt;
      c.x = lerp(c.x, c.targetX, clamp(7 * dt, 0, 1));
      c.y = lerp(c.y, c.targetY, clamp(7 * dt, 0, 1));
      c.angle += 10 * dt;
      if (c.acceptedTimer <= 0) {
        c.scored = true;
        c.accepting = false;
      }
      if (Math.random() < 0.35) {
        game.crunchFx.push({ x: c.targetX + (Math.random() - 0.5) * 0.3, y: c.targetY + (Math.random() - 0.5) * 0.2, life: 0.45 });
      }
    }
  }

  function updateCamera(dt) {
    const viewW = W / CONFIG.METER_TO_PX;
    const viewH = getGameplayHeight() / CONFIG.METER_TO_PX;
    const leftBound = game.camera.x - viewW * 0.25;
    const rightBound = game.camera.x + viewW * 0.25;
    let targetX = game.camera.x;

    // Camera dead-zone: follow only when ship enters left/right quarter bounds.
    if (ship.x < leftBound) targetX = ship.x + viewW * 0.25;
    if (ship.x > rightBound) targetX = ship.x - viewW * 0.25;

    const minXRaw = viewW * 0.5;
    const maxXRaw = CONFIG.worldWidth - viewW * 0.5;
    const minX = Math.min(minXRaw, maxXRaw);
    const maxX = Math.max(minXRaw, maxXRaw);
    const maxLagMeters = viewW * 0.42;
    const shipCameraDeltaX = ship.x - targetX;
    if (Math.abs(shipCameraDeltaX) > maxLagMeters) {
      targetX = ship.x - Math.sign(shipCameraDeltaX) * maxLagMeters;
    }
    targetX = clamp(targetX, minX, maxX);

    const targetY = ship.y - Math.max(3.6, viewH * 0.18);
    game.camera.x = lerp(game.camera.x, targetX, clamp(CONFIG.cameraSmooth * dt, 0, 1));
    game.camera.y = lerp(game.camera.y, targetY, clamp(6 * dt, 0, 1));

    const gameplayH = getGameplayHeight();
    const shipScreenY = (ship.y - game.camera.y) * CONFIG.METER_TO_PX + getViewCenterY();
    if (shipScreenY < gameplayH * 0.12 || shipScreenY > gameplayH * 0.88) {
      game.camera.y = targetY;
    }

    game.camera.x = clamp(game.camera.x, minX, maxX);
  }

  function updateExplosions(dt) {
    for (const p of game.explosions) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 3 * dt;
      p.life -= dt * 1.1;
    }
    game.explosions = game.explosions.filter(p => p.life > 0);

    for (const p of game.crunchFx) p.life -= dt;
    game.crunchFx = game.crunchFx.filter(p => p.life > 0);
  }

  function toScreen(wx, wy) {
    const px = (wx - game.camera.x) * CONFIG.METER_TO_PX + W / 2;
    const py = (wy - game.camera.y) * CONFIG.METER_TO_PX + getViewCenterY();
    return { x: px, y: py };
  }

  function drawBackground() {
    ctx.fillStyle = '#02030b';
    ctx.fillRect(0, 0, W, H);

    for (const p of planets) {
      const px = (p.x - game.camera.x * 0.08) * CONFIG.METER_TO_PX + W / 2;
      const py = (p.y - game.camera.y * 0.03) * CONFIG.METER_TO_PX + H * 0.2;
      if (px < -p.r - 8 || px > W + p.r + 8 || py < -p.r - 8 || py > H + p.r + 8) continue;

      ctx.globalAlpha = p.alpha;
      const grad = ctx.createRadialGradient(px - p.r * 0.35, py - p.r * 0.35, p.r * 0.2, px, py, p.r);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.25, p.color);
      grad.addColorStop(1, '#141a2e');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, p.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = p.alpha * 0.45;
      ctx.strokeStyle = '#e6f0ff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(px, py, p.r * 1.28, p.phase, p.phase + Math.PI * 1.2);
      ctx.stroke();
    }

    for (const s of stars) {
      const parallaxX = (s.x - game.camera.x * 0.12) * CONFIG.METER_TO_PX + W / 2;
      const parallaxY = (s.y - game.camera.y * 0.05) * CONFIG.METER_TO_PX + H * 0.18;
      if (parallaxX < -4 || parallaxX > W + 4 || parallaxY < -4 || parallaxY > H + 4) continue;
      ctx.globalAlpha = s.a;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(parallaxX, parallaxY, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawTerrainAndPads() {
    const gameplayH = getGameplayHeight();
    ctx.beginPath();
    const first = toScreen(terrain.points[0].x, terrain.points[0].y);
    ctx.moveTo(first.x, first.y);
    for (const p of terrain.points) {
      const s = toScreen(p.x, p.y);
      ctx.lineTo(s.x, s.y);
    }
    const last = terrain.points[terrain.points.length - 1];
    const end = toScreen(last.x, last.y);
    ctx.lineTo(end.x, gameplayH + 30);
    ctx.lineTo(first.x, gameplayH + 30);
    ctx.closePath();
    ctx.fillStyle = '#3c3f4a';
    ctx.fill();

    for (const pad of terrain.pads) {
      const left = toScreen(pad.x - pad.w / 2, pad.y);
      const right = toScreen(pad.x + pad.w / 2, pad.y);

      ctx.strokeStyle = pad.kind === 'recycle' ? '#6cff9f' : '#66d7ff';
      ctx.lineWidth = 6.4;
      ctx.beginPath();
      ctx.moveTo(left.x, left.y - 2);
      ctx.lineTo(right.x, right.y - 2);
      ctx.stroke();

      const b = toScreen(pad.x + pad.w * 0.35, pad.y - 0.1);
      ctx.fillStyle = '#7f858f';
      ctx.fillRect(b.x, b.y - 42, 40, 42);

      ctx.fillStyle = '#121419';
      ctx.fillRect(b.x + 10, b.y - 33, 20, 12);
      ctx.fillStyle = '#d8dee9';
      ctx.font = 'bold 12px Segoe UI';
      if (pad.kind === 'recycle') {
        ctx.fillStyle = '#6f7782';
        ctx.fillRect(b.x - 18, b.y - 26, 18, 22);
        ctx.fillStyle = '#2c3038';
        ctx.beginPath();
        ctx.moveTo(b.x - 18, b.y - 26);
        ctx.lineTo(b.x, b.y - 26);
        ctx.lineTo(b.x, b.y - 12);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#8affb0';
        ctx.fillRect(left.x + 8, left.y - 22, Math.max(120, right.x - left.x - 16), 18);
        ctx.fillStyle = '#082b15';
        ctx.fillText('RECYCLE HERE', left.x + 16, left.y - 8);
      } else {
        ctx.fillStyle = '#8ecfff';
        ctx.fillRect(left.x + 10, left.y - 20, Math.max(95, right.x - left.x - 20), 16);
        ctx.fillStyle = '#06293e';
        ctx.fillText('REFUEL', left.x + 22, left.y - 8);
      }
    }
  }

  function drawCargo(c) {
    const s = toScreen(c.x, c.y);
    const r = c.r * CONFIG.METER_TO_PX;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(c.angle);
    ctx.fillStyle = c.color;
    ctx.strokeStyle = '#dfe7ff';
    ctx.lineWidth = 2;

    // Diverse ship-part silhouettes.
    if (c.shape === 'rectangle') {
      ctx.beginPath();
      ctx.rect(-r, -r * 0.55, r * 2, r * 1.1);
      ctx.fill();
      ctx.stroke();
    } else if (c.shape === 'triangle') {
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r, r * 0.9);
      ctx.lineTo(-r, r * 0.9);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (c.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (c.shape === 'trapezoid') {
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, -r);
      ctx.lineTo(r * 0.6, -r);
      ctx.lineTo(r, r);
      ctx.lineTo(-r, r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (c.shape === 'diamond') {
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // small panel details to sell "ship part" look
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, -r * 0.2);
    ctx.lineTo(r * 0.7, -r * 0.2);
    ctx.moveTo(-r * 0.5, r * 0.25);
    ctx.lineTo(r * 0.5, r * 0.25);
    ctx.stroke();

    ctx.restore();
  }

  function drawShip() {
    const center = toScreen(ship.x, ship.y);
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate(ship.angle);
    const m = CONFIG.METER_TO_PX;

    const flame = ship.fuel > 0 ? ship.throttle : 0;

    const rotateLeftFx = game.state === 'PLAYING' && keys.has('KeyA');
    const rotateRightFx = game.state === 'PLAYING' && keys.has('KeyD');
    if (rotateLeftFx || rotateRightFx) {
      ctx.strokeStyle = '#ff9f6a';
      ctx.lineWidth = 2.4;
      if (rotateLeftFx) {
        ctx.beginPath();
        ctx.moveTo(0.9 * m, -0.12 * m);
        ctx.lineTo(1.18 * m + Math.random() * 6, (-0.12 + (Math.random() - 0.5) * 0.06) * m);
        ctx.stroke();
      }
      if (rotateRightFx) {
        ctx.beginPath();
        ctx.moveTo(-0.9 * m, -0.12 * m);
        ctx.lineTo(-1.18 * m - Math.random() * 6, (-0.12 + (Math.random() - 0.5) * 0.06) * m);
        ctx.stroke();
      }
    }

    if (flame > 0.02) {
      ctx.strokeStyle = '#ffbf66';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, shipShape.thruster.y * m + 10);
      ctx.lineTo((Math.random() - 0.5) * 6, shipShape.thruster.y * m + 14 + flame * 38);
      ctx.stroke();
    }

    // Tray retract/extend bay
    const tr = getTrayRect();
    ctx.fillStyle = '#d5dbe6';
    ctx.fillRect(tr.x * m, tr.y * m, tr.w * m, tr.h * m);
    ctx.strokeStyle = '#18202c';
    ctx.strokeRect(tr.x * m, tr.y * m, tr.w * m, tr.h * m);
    ctx.fillStyle = '#d5dbe6';
    ctx.fillRect(tr.x * m, tr.y * m, 5, tr.h * m);
    ctx.fillRect((tr.x + tr.w) * m - 5, tr.y * m, 5, tr.h * m);

    // Landing gear feet + support arms
    const supportLocals = getSupportLocals();
    const footL = supportLocals.left;
    const footR = supportLocals.right;

    const footW = 0.434 * m;
    const footH = 0.07 * m;
    const armTopY = (shipShape.skidL.y - 0.28) * m;
    const retractedFootY = (shipShape.skidL.y - 0.3) * m;

    const leftFootCenterX = shipShape.skidL.x * m * 1.5;
    const rightFootCenterX = shipShape.skidR.x * m * 1.5;
    const leftFootCenterY = lerp(retractedFootY, footL.y * m, ship.gearDeploy);
    const rightFootCenterY = lerp(retractedFootY, footR.y * m, ship.gearDeploy);
    const drawGearVisual = !ship.tracksExtended || ship.gearDeploy > 0.001 || ship.tracksDeploy < 0.999;

    // 45-degree support arms (one per side), rendered behind the hull.
    if (drawGearVisual) {
      const legDropL = Math.max(0, leftFootCenterY - armTopY);
      const legDropR = Math.max(0, rightFootCenterY - armTopY);
      const leftTopX = leftFootCenterX + legDropL;
      const rightTopX = rightFootCenterX - legDropR;

      ctx.strokeStyle = '#8a96a4';
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(leftTopX, armTopY);
      ctx.lineTo(leftFootCenterX, leftFootCenterY);
      ctx.moveTo(rightTopX, armTopY);
      ctx.lineTo(rightFootCenterX, rightFootCenterY);
      ctx.stroke();
    }

    const trackY = (shipShape.skidL.y + 0.02) * m;
    const trackH = (0.33 * ship.tracksDeploy) * m;
    const trackW = 0.6 * m;
    const centerGap = 0.34 * m;
    const leftTrackX = -centerGap - trackW;
    const rightTrackX = centerGap;
    const joinX = leftTrackX + trackW;
    const joinW = rightTrackX - joinX;

    // Track support legs, rendered behind the hull so they look under-mounted.
    if (ship.tracksDeploy > 0.001) {
      const trackTopY = trackY;
      const leftTrackCenterX = leftTrackX + trackW * 0.5;
      const rightTrackCenterX = rightTrackX + trackW * 0.5;
      const trackLegTopY = (shipShape.skidL.y - 0.25) * m;

      ctx.strokeStyle = '#8a96a4';
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(leftTrackCenterX, trackLegTopY);
      ctx.lineTo(leftTrackCenterX, trackTopY);
      ctx.moveTo(rightTrackCenterX, trackLegTopY);
      ctx.lineTo(rightTrackCenterX, trackTopY);
      ctx.stroke();
    }

    // Hull
    ctx.fillStyle = '#d5dbe6';
    ctx.beginPath();
    shipShape.hullPoints.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x * m, p.y * m);
      else ctx.lineTo(p.x * m, p.y * m);
    });
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#18202c';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Centered recycle logo on hull (stacked to fit ship width)
    ctx.fillStyle = '#1f8f3a';
    ctx.font = `bold ${Math.max(10, m * 0.2)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Recycle', 0, -0.16 * m);
    ctx.fillText('Hero', 0, 0.02 * m);

    if (drawGearVisual) {
      // Feet (bright red), centered at each leg endpoint.
      ctx.fillStyle = '#ff2a2a';
      ctx.fillRect(leftFootCenterX - footW * 0.5, leftFootCenterY - footH * 0.5, footW, footH);
      ctx.fillRect(rightFootCenterX - footW * 0.5, rightFootCenterY - footH * 0.5, footW, footH);
    }

    if (ship.tracksDeploy > 0.001) {
      ctx.fillStyle = '#191c22';
      ctx.fillRect(leftTrackX, trackY, trackW, trackH);
      ctx.fillRect(rightTrackX, trackY, trackW, trackH);
      ctx.fillRect(joinX, trackY, joinW, trackH);

      ctx.fillStyle = '#646f7b';
      const treadInset = 0.06 * m;
      ctx.fillRect(leftTrackX + treadInset, trackY + trackH * 0.22, trackW - treadInset * 2, trackH * 0.56);
      ctx.fillRect(rightTrackX + treadInset, trackY + trackH * 0.22, trackW - treadInset * 2, trackH * 0.56);
      ctx.fillRect(joinX + treadInset * 0.5, trackY + trackH * 0.22, Math.max(0, joinW - treadInset), trackH * 0.56);

      const wheelR = Math.max(1.2, trackH * 0.25);
      ctx.fillStyle = '#ffffff';
      const leftCenterX = leftTrackX + trackW * 0.5;
      const rightCenterX = rightTrackX + trackW * 0.5;
      const topY = trackY + wheelR + 2;
      const bottomY = trackY + trackH - wheelR - 2;
      for (const cx of [leftCenterX, rightCenterX]) {
        for (const cy of [topY, bottomY]) {
          ctx.beginPath();
          ctx.arc(cx, cy, wheelR, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Crane segments
    const base = shipShape.craneBase;
    const bAng = -Math.PI / 2 + ship.baseAngle;
    const seg1Len = 2.14;
    const seg2Len = 1.91;
    const p1 = { x: base.x + Math.cos(bAng) * seg1Len, y: base.y + Math.sin(bAng) * seg1Len };
    const a1 = bAng + (ship.seg1Angle - Math.PI / 2);
    const p2 = { x: p1.x + Math.cos(a1) * seg2Len, y: p1.y + Math.sin(a1) * seg2Len };
    const a2 = a1 + (ship.seg2Angle - Math.PI / 2);

    const armThickness = 6.4;
    const jointDiameter = armThickness * 1.3;
    const jointRadiusPx = jointDiameter * 0.5 * 1.3;
    const innerJointRadiusPx = jointRadiusPx * 0.5;

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = armThickness;
    ctx.beginPath();
    ctx.moveTo(base.x * m, base.y * m);
    ctx.lineTo(p1.x * m, p1.y * m);
    ctx.lineTo(p2.x * m, p2.y * m);
    ctx.stroke();

    // Claw (single-color white, fully connected to arm by a rectangular coupler)
    const open = lerp(0.03, 0.42, ship.clawOpen);
    const tip = { x: p2.x + Math.cos(a2) * 0.26, y: p2.y + Math.sin(a2) * 0.26 };
    const n = { x: Math.cos(a2 + Math.PI / 2), y: Math.sin(a2 + Math.PI / 2) };
    const forward = { x: Math.cos(a2), y: Math.sin(a2) };

    // Rectangular connector to remove visual gap from arm to claw fingers.
    const couplerLen = 0.22;
    const couplerHalfW = 0.08;
    const c0 = { x: p2.x - n.x * couplerHalfW, y: p2.y - n.y * couplerHalfW };
    const c1 = { x: p2.x + n.x * couplerHalfW, y: p2.y + n.y * couplerHalfW };
    const c2 = { x: p2.x + forward.x * couplerLen + n.x * couplerHalfW, y: p2.y + forward.y * couplerLen + n.y * couplerHalfW };
    const c3 = { x: p2.x + forward.x * couplerLen - n.x * couplerHalfW, y: p2.y + forward.y * couplerLen - n.y * couplerHalfW };
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(c0.x * m, c0.y * m);
    ctx.lineTo(c1.x * m, c1.y * m);
    ctx.lineTo(c2.x * m, c2.y * m);
    ctx.lineTo(c3.x * m, c3.y * m);
    ctx.closePath();
    ctx.fill();

    function drawFinger(sign) {
      const root = { x: tip.x + n.x * open * sign, y: tip.y + n.y * open * sign };
      const pA = { x: root.x + forward.x * 0.44, y: root.y + forward.y * 0.44 };
      const pB = { x: root.x + n.x * 0.24 * sign, y: root.y + n.y * 0.24 * sign };
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(root.x * m, root.y * m);
      ctx.lineTo(pA.x * m, pA.y * m);
      ctx.lineTo(pB.x * m, pB.y * m);
      ctx.closePath();
      ctx.fill();
    }
    drawFinger(1);
    drawFinger(-1);

    // Joint circles for arm joints (30% larger than previous size).
    function drawJoint(localPoint) {
      ctx.fillStyle = '#ff2f2f';
      ctx.beginPath();
      ctx.arc(localPoint.x * m, localPoint.y * m, jointRadiusPx, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(localPoint.x * m, localPoint.y * m, innerJointRadiusPx, 0, Math.PI * 2);
      ctx.fill();
    }
    drawJoint(base);
    drawJoint(p1);
    drawJoint(p2);

    ctx.restore();
  }

  function drawExplosions() {
    for (const p of game.explosions) {
      const s = toScreen(p.x, p.y);
      ctx.globalAlpha = p.life;
      ctx.fillStyle = '#ff9f3d';
      ctx.beginPath();
      ctx.arc(s.x, s.y, (1 - p.life) * 16 + 3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of game.crunchFx) {
      const s = toScreen(p.x, p.y);
      ctx.globalAlpha = p.life * 1.4;
      ctx.fillStyle = '#c8cdd7';
      ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
  }



  function drawBottomConsole() {
    const h = getConsoleHeight();
    const y = H - h;
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, y, W, h);
    ctx.strokeStyle = '#303030';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y + 1);
    ctx.lineTo(W, y + 1);
    ctx.stroke();

    const pad = 16;
    const gap = 12;
    const panelH = h - 24;
    const panelY = y + 12;

    function drawBar(x, w, label, value, unit = '%') {
      ctx.fillStyle = '#000';
      ctx.fillRect(x, panelY, w, panelH);
      ctx.strokeStyle = '#0b5';
      ctx.strokeRect(x, panelY, w, panelH);
      ctx.fillStyle = '#0f7d3a';
      const fillW = Math.max(0, Math.min(1, value)) * (w - 18);
      ctx.fillRect(x + 9, panelY + panelH * 0.55, fillW, panelH * 0.28);
      ctx.fillStyle = '#7dff9c';
      ctx.font = 'bold 14px Segoe UI';
      ctx.fillText(label, x + 10, panelY + 20);
      ctx.font = 'bold 18px Consolas, monospace';
      ctx.fillText(`${Math.round(value * 100)}${unit}`, x + 10, panelY + 44);
    }

    const innerW = W - pad * 2;
    const barW = Math.max(160, Math.min(280, innerW * 0.18));
    const fuelX = pad + barW + gap;
    drawBar(pad, barW, 'THROTTLE', ship.throttle);
    drawBar(fuelX, barW, 'FUEL', ship.fuel / 100);

    const gaugeSize = Math.min(panelH - 10, 110);
    const attitudePanelW = gaugeSize + 32;
    const attitudeX = fuelX + barW + gap;
    const gx = attitudeX + attitudePanelW / 2;
    const gy = panelY + panelH / 2 + 10;
    ctx.fillStyle = '#000';
    ctx.fillRect(attitudeX, panelY, attitudePanelW, panelH);
    ctx.strokeStyle = '#0b5';
    ctx.strokeRect(attitudeX, panelY, attitudePanelW, panelH);
    ctx.strokeStyle = '#7dff9c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(gx, gy, gaugeSize * 0.37, 0, Math.PI * 2);
    ctx.stroke();
    ctx.save();
    ctx.translate(gx, gy);
    ctx.rotate(ship.angle);
    ctx.strokeStyle = '#7dff9c';
    ctx.beginPath();
    ctx.moveTo(-gaugeSize * 0.28, 0);
    ctx.lineTo(gaugeSize * 0.28, 0);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#7dff9c';
    ctx.font = 'bold 13px Segoe UI';
    ctx.fillText('ATTITUDE', gx - 30, panelY + 16);

    const dX = attitudeX + attitudePanelW + gap;
    const totalW = Math.max(280, W - dX - pad);
    const scoreW = Math.min(220, Math.max(150, totalW * 0.3));
    const distW = totalW - scoreW - gap;

    ctx.fillStyle = '#000';
    ctx.fillRect(dX, panelY, distW, panelH);
    ctx.strokeStyle = '#0b5';
    ctx.strokeRect(dX, panelY, distW, panelH);
    const dist = distanceToGroundMeters();
    ctx.fillStyle = '#7dff9c';
    ctx.font = 'bold 15px Segoe UI';
    ctx.fillText('DISTANCE TO GROUND', dX + 12, panelY + 22);
    ctx.font = 'bold 44px "Consolas", monospace';
    ctx.fillText(`${dist.toFixed(1)} m`, dX + 12, panelY + panelH * 0.72);

    const scoreX = dX + distW + gap;
    ctx.fillStyle = '#000';
    ctx.fillRect(scoreX, panelY, scoreW, panelH);
    ctx.strokeStyle = '#0b5';
    ctx.strokeRect(scoreX, panelY, scoreW, panelH);
    ctx.fillStyle = '#7dff9c';
    ctx.font = 'bold 15px Segoe UI';
    ctx.fillText('SCORE', scoreX + 12, panelY + 22);
    ctx.font = 'bold 46px "Consolas", monospace';
    ctx.fillText(`${game.score}`, scoreX + 12, panelY + panelH * 0.74);
  }



  function drawLeftInfoPanel(title, lines) {
    const panelW = Math.min(860, Math.max(420, Math.floor(W * 0.8)));
    const panelH = Math.min(H - 36, Math.max(320, Math.floor(H * 0.8)));
    const panelX = Math.floor((W - panelW) * 0.5);
    const panelY = Math.floor((H - panelH) * 0.5);

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(8,12,20,0.94)';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = '#2b2b2b';
    ctx.lineWidth = 2;
    ctx.strokeRect(panelX, panelY, panelW, panelH);

    const padX = panelX + 30;
    const padY = panelY + 24;
    const maxW = panelW - 60;
    const nonEmpty = lines.filter(Boolean);

    let bodySize = 26;
    for (; bodySize >= 11; bodySize -= 1) {
      const titleSize = Math.round(bodySize * 1.5);
      const lineGap = Math.max(8, Math.round(bodySize * 0.52));
      const rowH = Math.round(bodySize * 1.45);
      const titleH = Math.round(titleSize * 1.12);
      const totalRowsH = titleH + lineGap * 2 + lines.length * rowH;
      const maxLine = nonEmpty.reduce((m, line) => {
        ctx.font = `bold ${bodySize}px Segoe UI`;
        return Math.max(m, ctx.measureText(line).width);
      }, 0);
      ctx.font = `bold ${titleSize}px Segoe UI`;
      const titleW = ctx.measureText(title).width;
      if (totalRowsH <= panelH - 34 && Math.max(maxLine, titleW) <= maxW) break;
    }

    const titleSize = Math.round(bodySize * 1.5);
    const lineGap = Math.max(8, Math.round(bodySize * 0.52));
    const rowH = Math.round(bodySize * 1.45);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const centerX = panelX + panelW * 0.5;
    let y = padY + Math.round(titleSize * 0.6);

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${titleSize}px Segoe UI`;
    ctx.fillText(title, centerX, y);

    y += lineGap;
    ctx.strokeStyle = '#34506e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(panelX + 34, y + 1);
    ctx.lineTo(panelX + panelW - 34, y + 1);
    ctx.stroke();

    y += lineGap;
    ctx.font = `bold ${bodySize}px Segoe UI`;
    for (const line of lines) {
      y += rowH;
      if (!line) continue;
      ctx.fillText(line, centerX, y);
    }

    ctx.restore();
  }



  function drawHUD() {
    if (game.paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 46px Segoe UI';
      ctx.fillText('PAUSED', W / 2 - 90, H / 2);
    }

    if (game.state === 'CRASHED') {
      ctx.fillStyle = 'rgba(90,0,0,0.35)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ff7575';
      ctx.font = 'bold 50px Segoe UI';
      ctx.fillText('CRASHED', W / 2 - 120, H / 2 - 20);
      ctx.font = '20px Segoe UI';
      ctx.fillStyle = '#ffd3d3';
      ctx.fillText('Respawning...', W / 2 - 65, H / 2 + 16);
    }

    if (game.state === 'READY') {
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      ctx.fillRect(0, 0, W, H);

      const gameplayH = getGameplayHeight();
      const titleY = gameplayH * 0.42;
      const subY = gameplayH * 0.52;

      let titleSize = Math.min(56, Math.max(22, Math.round(gameplayH * 0.09)));
      for (; titleSize >= 18; titleSize -= 1) {
        ctx.font = `bold ${titleSize}px Segoe UI`;
        if (ctx.measureText('SPACE RECYCLE HERO').width <= W - 48) break;
      }
      let subSize = Math.min(30, Math.max(14, Math.round(gameplayH * 0.05)));
      for (; subSize >= 12; subSize -= 1) {
        ctx.font = `bold ${subSize}px Segoe UI`;
        if (ctx.measureText('PRESS SPACE TO START').width <= W - 48) break;
      }

      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${titleSize}px Segoe UI`;
      ctx.fillText('SPACE RECYCLE HERO', W / 2, titleY);
      ctx.font = `bold ${subSize}px Segoe UI`;
      ctx.fillStyle = '#9ce8ff';
      ctx.fillText('PRESS SPACE TO START', W / 2, subY);

      ctx.fillStyle = '#ff4f4f';
      ctx.font = `bold ${Math.max(14, Math.round(subSize * 0.78))}px Segoe UI`;
      ctx.fillText('PRESS H FOR CONTROLS', W / 2, subY + Math.max(30, subSize * 1.6));
      ctx.textAlign = 'left';
    }


    drawBottomConsole();


    if (game.showHelp) {
      drawLeftInfoPanel('MISSION CONTROLS', [
        'A / D — Rotate the ship left or right while flying.',
        'W / S — Increase or decrease engine throttle.',
        'SPACE — Start mission, then open or close the cargo tray.',
        'K / L — Rotate the arm base counterclockwise / clockwise.',
        'I / O — Move arm segment 1 up / down.',
        'N / M — Move arm segment 2 up / down.',
        ', / . — Close or open the claw to grab cargo.',
        'E — Extend or retract landing gear (2-second movement).',
        'Q — Toggle track mode when landed and stable.',
        'H — Show/hide this help panel. ESC — Pause/unpause.',
        'Land gently on skids, refuel pads refill fuel,',
        'and recycle pads score delivered cargo.',
      ]);
    }

  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;

    if (!game.paused) {
      updateInput(dt);
      if (game.state === 'CRASHED') {
        ship.crashTimer -= dt;
        updateExplosions(dt);
        if (ship.crashTimer <= 0) respawnShip();
      } else if (game.state === 'PLAYING') {
        updateShip(dt);
        updateCargo(dt);
        updateSupplyShips(dt);
        updateCamera(dt);
      } else if (game.state === 'READY') {
        updateCamera(dt);
      }
      updateExplosions(dt);
      updateAudio();
    }

    drawBackground();
    drawSupplyShips();
    drawTerrainAndPads();
    for (const c of cargos) {
      if (c.scored) continue;
      if (c.stored && ship.traySlide < 0.55) continue;
      drawCargo(c);
    }
    if (game.state !== 'CRASHED') drawShip();
    drawExplosions();
    drawHUD();

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();
