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
    armFoldDurationSec: 5,

    worldWidth: 260,
    terrainStep: 2,
    starCount: 1632,
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
    trayCapacity: 5,
  };

  const MULTIPLAYER = {
    maxPlayers: 20,
    statePushHz: 15,
    reconnectMs: 2000,
  };

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const radioHud = document.getElementById('radioHud');
  const radioInput = document.getElementById('radioInput');
  const radioSend = document.getElementById('radioSend');

  let W = 1280;
  let H = 720;
  let stars = [];
  let planets = [];

  function resize() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (stars.length) regenerateStars();
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

  function trimRadioMessage(text) {
    return text.trim().replace(/\s+/g, ' ').slice(0, 120);
  }

  function getSessionMacAddressToken() {
    const key = 'srh-device-mac-token';
    const stored = localStorage.getItem(key);
    if (stored) return stored;
    const randomHex = Array.from(crypto.getRandomValues(new Uint8Array(6)))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join(':');
    localStorage.setItem(key, randomHex);
    return randomHex;
  }

  function sendRadioMessage() {
    const text = trimRadioMessage(radioInput.value || '');
    if (!text) return;
    game.radioMessage.text = text;
    game.radioMessage.timer = 5;
    sendSocketMessage('radio', { text });
    radioInput.value = '';
    radioInput.blur();
  }

  function setRadioHudLayout(x, y, w, h, uiScale) {
    if (!radioHud) return;
    radioHud.style.display = 'block';
    radioHud.style.left = `${Math.round(x)}px`;
    radioHud.style.top = `${Math.round(y)}px`;
    radioHud.style.width = `${Math.round(w)}px`;
    radioHud.style.height = `${Math.round(h)}px`;
    radioHud.style.padding = `${Math.max(6, Math.round(8 * uiScale))}px ${Math.max(8, Math.round(10 * uiScale))}px`;

    const labelSize = Math.max(9, Math.round(12 * uiScale));
    const inputSize = Math.max(10, Math.round(13 * uiScale));
    const buttonSize = Math.max(9, Math.round(12 * uiScale));
    const buttonBottom = Math.max(6, Math.round(8 * uiScale));

    radioHud.querySelector('label').style.fontSize = `${labelSize}px`;
    radioInput.style.fontSize = `${inputSize}px`;
    radioInput.style.padding = `${Math.max(4, Math.round(5 * uiScale))}px ${Math.max(5, Math.round(7 * uiScale))}px`;
    radioInput.style.paddingRight = `${Math.max(68, Math.round(78 * uiScale))}px`;
    radioInput.style.marginTop = `${Math.max(2, Math.round(3 * uiScale))}px`;

    radioSend.style.fontSize = `${buttonSize}px`;
    radioSend.style.right = `${Math.max(6, Math.round(8 * uiScale))}px`;
    radioSend.style.bottom = `${buttonBottom}px`;
    radioSend.style.padding = `${Math.max(3, Math.round(4 * uiScale))}px ${Math.max(8, Math.round(12 * uiScale))}px`;
  }

  window.addEventListener('resize', resize);
  resize();

  if (radioInput) {
    radioInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter' || e.key === 'Enter') {
        e.preventDefault();
        sendRadioMessage();
      }
    });
    radioInput.addEventListener('keyup', (e) => e.stopPropagation());
  }
  if (radioSend) radioSend.addEventListener('click', sendRadioMessage);

  const keys = new Set();
  const blocked = new Set(['KeyW','KeyA','KeyS','KeyD','KeyU','KeyJ','KeyI','KeyK','KeyO','KeyP','KeyL','Semicolon','Space','Escape','KeyH','KeyQ','KeyE','KeyF']);
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
      else if (game.state === 'PLAYING') {
        ship.trayExtended = !ship.trayExtended;
        playTraySealSound(ship.trayExtended);
      }
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
        if (!ship.landed) ship.gearExtended = !ship.gearExtended;
        else ship.gearExtended = true;
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
        ship.gearSafetyTimer = CONFIG.landingGearTransitionSec + 0.35;
      }
    }
    if (e.code === 'KeyF' && game.state === 'PLAYING') {
      const togglingToFolded = !ship.armFolded;
      ship.armFolded = togglingToFolded;
      if (togglingToFolded) {
        if (ship.grabbedCargo) {
          ship.grabbedCargo.grabbed = false;
          ship.grabbedCargo = null;
        }
      } else {
        const unfoldPose = getDefaultUnfoldedArmPose();
        ship.armDeployPose.baseAngle = unfoldPose.baseAngle;
        ship.armDeployPose.seg1Angle = unfoldPose.seg1Angle;
        ship.armDeployPose.seg2Angle = unfoldPose.seg2Angle;
        ship.armDeployPose.clawOpen = unfoldPose.clawOpen;
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

  function getDefaultUnfoldedArmPose() {
    // High, ready-to-use pose that unfolds toward the ship's right side.
    return {
      baseAngle: 78 * Math.PI / 180,
      seg1Angle: 2.55,
      seg2Angle: 2.72,
      clawOpen: 1,
    };
  }

  const ARM_STOW_DROP_MAX = 2.55;

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

  function regenerateStars() {
    stars = Array.from({ length: CONFIG.starCount }, () => ({
      x: Math.random() * (W + 80) - 40,
      y: Math.random() * (getGameplayHeight() * 0.9) + 6,
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
    armFolded: false,
    armFoldBlend: 0,
    armStowDrop: 0,
    armDeployPose: {
      baseAngle: 0,
      seg1Angle: 2.9,
      seg2Angle: 3.05,
      clawOpen: 1,
    },
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
    radioMessage: { text: '', timer: 0 },
  };

  const multiplayer = {
    sessionMac: getSessionMacAddressToken(),
    connected: false,
    playerId: null,
    others: new Map(),
    pushTimer: 0,
  };

  async function sendSocketMessage(type, payload = {}) {
    if (!multiplayer.playerId && type !== 'join') return null;
    const endpointByType = {
      join: '/api/join',
      radio: '/api/radio',
      'request-spawn': '/api/spawn',
      'state-update': '/api/state',
    };
    const endpoint = endpointByType[type];
    if (!endpoint) return null;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: multiplayer.playerId, ...payload }),
    });
    if (!response.ok) return null;
    return response.json();
  }

  function setShipSpawn(x) {
    shipSpawn.x = clamp(x, shipShape.hullRadius + 0.2, CONFIG.worldWidth - shipShape.hullRadius - 0.2);
    shipSpawn.y = terrainY(shipSpawn.x) - shipShape.skidL.y;
    ship.x = shipSpawn.x;
    ship.y = shipSpawn.y;
    setShipOnGround();
  }

  async function connectMultiplayer() {
    try {
      const joined = await sendSocketMessage('join', {
        macAddress: multiplayer.sessionMac,
        maxPlayers: MULTIPLAYER.maxPlayers,
      });
      if (!joined || !joined.playerId) throw new Error('join-failed');
      multiplayer.connected = true;
      multiplayer.playerId = joined.playerId;
      setShipSpawn(joined.spawnX);
    } catch {
      multiplayer.connected = false;
      multiplayer.playerId = null;
      multiplayer.others.clear();
      setTimeout(connectMultiplayer, MULTIPLAYER.reconnectMs);
    }
  }




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
    ship.trayExtended = false;
    ship.traySlide = 0;
    ship.tracksExtended = false;
    ship.tracksDeploy = 0;
    ship.gearExtended = true;
    ship.gearDeploy = 1;
    ship.gearSafetyTimer = 0;
    ship.armFolded = false;
    ship.armFoldBlend = 0;
    ship.armStowDrop = 0;
    const unfoldPose = getDefaultUnfoldedArmPose();
    ship.armDeployPose.baseAngle = unfoldPose.baseAngle;
    ship.armDeployPose.seg1Angle = unfoldPose.seg1Angle;
    ship.armDeployPose.seg2Angle = unfoldPose.seg2Angle;
    ship.armDeployPose.clawOpen = unfoldPose.clawOpen;
    ship.baseAngle = unfoldPose.baseAngle;
    ship.seg1Angle = unfoldPose.seg1Angle;
    ship.seg2Angle = unfoldPose.seg2Angle;
    ship.clawOpen = unfoldPose.clawOpen;
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

    const trackEngineGain = ctxA.createGain();
    trackEngineGain.gain.value = 0;
    const trackEngine = ctxA.createOscillator();
    trackEngine.type = 'sawtooth';
    trackEngine.frequency.value = 42;
    const trackEngineSub = ctxA.createOscillator();
    trackEngineSub.type = 'triangle';
    trackEngineSub.frequency.value = 28;
    const trackEngineFilter = ctxA.createBiquadFilter();
    trackEngineFilter.type = 'lowpass';
    trackEngineFilter.frequency.value = 300;
    trackEngine.connect(trackEngineFilter);
    trackEngineSub.connect(trackEngineFilter);
    trackEngineFilter.connect(trackEngineGain);
    trackEngineGain.connect(master);
    trackEngine.start();
    trackEngineSub.start();

    game.audio = {
      ctx: ctxA,
      master,
      rumble,
      rumbleGain,
      rocketTone,
      rocketToneGain,
      hydro,
      hydroGain,
      trackEngine,
      trackEngineSub,
      trackEngineGain,
      trackEngineFilter,
      lastThudTime: -10,
    };
  }


  function playTraySealSound(opening) {
    const a = game.audio;
    if (!a) return;
    const now = a.ctx.currentTime;

    const tone = a.ctx.createOscillator();
    tone.type = 'square';
    tone.frequency.setValueAtTime(opening ? 320 : 250, now);
    tone.frequency.exponentialRampToValueAtTime(opening ? 170 : 135, now + 0.17);

    const hiss = a.ctx.createOscillator();
    hiss.type = 'sawtooth';
    hiss.frequency.setValueAtTime(opening ? 540 : 440, now);
    hiss.frequency.exponentialRampToValueAtTime(opening ? 280 : 220, now + 0.12);

    const gain = a.ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.085, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

    const filter = a.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(opening ? 1200 : 980, now);

    tone.connect(filter);
    hiss.connect(filter);
    filter.connect(gain);
    gain.connect(a.master);

    tone.start(now);
    hiss.start(now);
    tone.stop(now + 0.25);
    hiss.stop(now + 0.17);
  }


  function playExplosionSound() {
    const a = game.audio;
    if (!a) return;
    const now = a.ctx.currentTime;

    const boom = a.ctx.createOscillator();
    boom.type = 'triangle';
    boom.frequency.setValueAtTime(140, now);
    boom.frequency.exponentialRampToValueAtTime(42, now + 0.38);

    const tail = a.ctx.createOscillator();
    tail.type = 'sawtooth';
    tail.frequency.setValueAtTime(95, now);
    tail.frequency.exponentialRampToValueAtTime(28, now + 0.48);

    const gain = a.ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.52);

    const filter = a.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, now);

    boom.connect(filter);
    tail.connect(filter);
    filter.connect(gain);
    gain.connect(a.master);

    boom.start(now);
    tail.start(now + 0.01);
    boom.stop(now + 0.53);
    tail.stop(now + 0.53);
  }

  function playCargoThudSound(intensity = 1) {
    const a = game.audio;
    if (!a) return;
    const now = a.ctx.currentTime;
    if (now - a.lastThudTime < 0.07) return;
    a.lastThudTime = now;

    const thud = a.ctx.createOscillator();
    thud.type = 'triangle';
    thud.frequency.setValueAtTime(82 + 10 * intensity, now);
    thud.frequency.exponentialRampToValueAtTime(42, now + 0.12);

    const gain = a.ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.06 + Math.min(0.09, 0.03 * intensity), now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);

    const filter = a.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(460, now);

    thud.connect(filter);
    filter.connect(gain);
    gain.connect(a.master);

    thud.start(now);
    thud.stop(now + 0.18);
  }

  function updateAudio() {
    const a = game.audio;
    if (!a) return;
    const t = a.ctx.currentTime;

    if (a.ctx.state === 'suspended' && game.state === 'PLAYING') a.ctx.resume();

    const playing = game.state === 'PLAYING' && !game.paused;

    const armMoving = keys.has('KeyI') || keys.has('KeyK') ||
      keys.has('KeyU') || keys.has('KeyJ') ||
      keys.has('KeyO') || keys.has('KeyP') ||
      keys.has('KeyL') || keys.has('Semicolon');

    const targetRumble = playing ? Math.max(0, ship.throttle) * 0.1352 : 0;
    a.rumbleGain.gain.setTargetAtTime(targetRumble, t, 0.05);
    a.rumble.frequency.setTargetAtTime(52 + ship.throttle * 35, t, 0.05);

    const targetRocketTone = playing ? Math.max(0, ship.throttle) * 0.0845 : 0;
    a.rocketToneGain.gain.setTargetAtTime(targetRocketTone, t, 0.04);
    a.rocketTone.frequency.setTargetAtTime(95 + ship.throttle * 120, t, 0.05);

    const targetHydro = (playing && armMoving) ? 0.09295 : 0;
    a.hydroGain.gain.setTargetAtTime(targetHydro, t, 0.02);
    a.hydro.frequency.setTargetAtTime(180 + Math.abs(Math.sin(t * 18)) * 180, t, 0.015);

    const trackModeActive = playing && ship.tracksDeploy > 0.55;
    const trackSpeed = Math.abs(ship.vx);
    // Low V8-style bed with lumpy-cam style idle pulse.
    const lumpy = 0.6 + 0.4 * Math.sin(t * 17) * Math.sin(t * 7.5);
    const idleBase = 28;
    const driveAdd = Math.min(38, trackSpeed * 22);
    const mainFreq = idleBase + driveAdd + lumpy * 2.2;
    const subFreq = Math.max(18, mainFreq * 0.62 + Math.sin(t * 9.5) * 1.2);
    const targetTrackGain = trackModeActive ? (0.045 + Math.min(0.16, trackSpeed * 0.12) + lumpy * 0.01) : 0;
    a.trackEngineGain.gain.setTargetAtTime(targetTrackGain, t, 0.045);
    a.trackEngine.frequency.setTargetAtTime(mainFreq, t, 0.055);
    a.trackEngineSub.frequency.setTargetAtTime(subFreq, t, 0.06);
    a.trackEngineFilter.frequency.setTargetAtTime(trackModeActive ? (220 + Math.min(520, trackSpeed * 240) + lumpy * 45) : 180, t, 0.06);

    a.master.gain.setTargetAtTime(playing ? 0.24 : 0.1, t, 0.08);
  }

  randomizeWorld();
  shipSpawn.y = terrainY(shipSpawn.x) - shipShape.skidL.y;
  ship.x = shipSpawn.x;
  ship.y = shipSpawn.y;
  setShipOnGround();
  game.camera.x = ship.x;
  game.camera.y = ship.y - 6;

  connectMultiplayer();

  function getArmKinematics() {
    const baseLocal = { x: shipShape.craneBase.x, y: shipShape.craneBase.y + ship.armStowDrop * ARM_STOW_DROP_MAX };
    const base = worldFromLocal(ship, baseLocal);
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
    sendSocketMessage('state-update', { x: ship.x, y: ship.y, angle: ship.angle, crashed: true, radioMessage: '' });
    ship.crashTimer = CONFIG.respawnSeconds;
    ship.landed = false;
    ship.grabbedCargo = null;
    ship.bounceCount = 0;
    ship.settleLock = false;

    playExplosionSound();

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
    ship.armFolded = false;
    ship.armFoldBlend = 0;
    ship.armStowDrop = 0;
    const unfoldPose = getDefaultUnfoldedArmPose();
    ship.armDeployPose.baseAngle = unfoldPose.baseAngle;
    ship.armDeployPose.seg1Angle = unfoldPose.seg1Angle;
    ship.armDeployPose.seg2Angle = unfoldPose.seg2Angle;
    ship.armDeployPose.clawOpen = unfoldPose.clawOpen;
    ship.baseAngle = unfoldPose.baseAngle;
    ship.seg1Angle = unfoldPose.seg1Angle;
    ship.seg2Angle = unfoldPose.seg2Angle;
    ship.clawOpen = unfoldPose.clawOpen;
    setShipOnGround();
    game.camera.x = ship.x;
    game.camera.y = ship.y - 6;
    game.state = 'READY';
    sendSocketMessage('request-spawn').then((spawn) => {
      if (spawn && typeof spawn.spawnX === 'number') setShipSpawn(spawn.spawnX);
    });
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

    const armControlLocked = ship.armFolded || ship.armFoldBlend > 0.02;
    if (!armControlLocked) {
      if (keys.has('KeyI')) ship.baseAngle -= CONFIG.baseRate * dt;
      if (keys.has('KeyK')) ship.baseAngle += CONFIG.baseRate * dt;
      if (keys.has('KeyU')) ship.seg1Angle -= CONFIG.seg1Rate * dt;
      if (keys.has('KeyJ')) ship.seg1Angle += CONFIG.seg1Rate * dt;
      if (keys.has('KeyO')) ship.seg2Angle -= CONFIG.seg2Rate * dt;
      if (keys.has('KeyL')) ship.seg2Angle += CONFIG.seg2Rate * dt;
      if (keys.has('KeyP')) ship.clawOpen = clamp(ship.clawOpen - CONFIG.clawRate * dt, 0, 1);
      if (keys.has('Semicolon')) ship.clawOpen = clamp(ship.clawOpen + CONFIG.clawRate * dt, 0, 1);
      ship.armDeployPose.baseAngle = ship.baseAngle;
      ship.armDeployPose.seg1Angle = ship.seg1Angle;
      ship.armDeployPose.seg2Angle = ship.seg2Angle;
      ship.armDeployPose.clawOpen = ship.clawOpen;
    }

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

    ship.armFoldBlend = moveTowards(ship.armFoldBlend, ship.armFolded ? 1 : 0, dt / CONFIG.armFoldDurationSec);
    const verticalPose = {
      // Step 1: raise arm to an upright vertical pose.
      baseAngle: 0,
      seg1Angle: Math.PI / 2,
      seg2Angle: Math.PI / 2,
      clawOpen: 0.18,
    };
    // Step 2: keep the arm vertical and lower it straight down into the ship.
    const lowerStart = 0.72;
    const lowerT = clamp((ship.armFoldBlend - lowerStart) / (1 - lowerStart), 0, 1);
    ship.armStowDrop = lowerT * ARM_STOW_DROP_MAX;
    if (ship.armFolded || ship.armFoldBlend > 0.001) {
      const tFoldUp = clamp(ship.armFoldBlend / lowerStart, 0, 1);
      ship.baseAngle = lerp(ship.armDeployPose.baseAngle, verticalPose.baseAngle, tFoldUp);
      ship.seg1Angle = lerp(ship.armDeployPose.seg1Angle, verticalPose.seg1Angle, tFoldUp);
      ship.seg2Angle = lerp(ship.armDeployPose.seg2Angle, verticalPose.seg2Angle, tFoldUp);
      ship.clawOpen = lerp(ship.armDeployPose.clawOpen, verticalPose.clawOpen, tFoldUp);
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
        if (c.scored || c.accepting || c.stored || c.grabbed || c.popping || c.ignoreTrayTimer > 0) continue;
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
      || (!ship.tracksExtended && (ship.tracksDeploy > 0.02 || (ship.gearExtended && ship.gearDeploy < 0.98)));
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
      if (ship.gearDeploy < 0.85) return crashShip('retracted-gear-ground-impact');

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
    const liftOffRequested = !tracksDriving && !tracksLock && ship.throttle >= 0.2 && ship.fuel > 0;
    if (ship.landed && liftOffRequested) {
      ship.landed = false;
      ship.settleLock = false;
      ship.bounceCount = 0;
      ship.vy = Math.min(ship.vy, -0.35);
    }
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
        const ground = Math.min(terrainY(skidL.x) - supportLLocal.y, terrainY(skidR.x) - supportRLocal.y);
        ship.y = ground;
      } else {
        ship.vx *= 0.93;
        ship.av *= 0.55;

        // Settle to slope so both landing feet sit on terrain without popping.
        const skidBaseLX = clamp(ship.x + supportLLocal.x, 0, CONFIG.worldWidth);
        const skidBaseRX = clamp(ship.x + supportRLocal.x, 0, CONFIG.worldWidth);
        const gyL = terrainY(skidBaseLX);
        const gyR = terrainY(skidBaseRX);
        const targetAngle = Math.atan2(gyR - gyL, Math.max(0.001, skidBaseRX - skidBaseLX));
        ship.angle = lerp(ship.angle, targetAngle, clamp(10 * dt, 0, 1));
        ship.av *= 0.45;

        const settledSkidL = worldFromLocal(ship, supportLLocal);
        const settledSkidR = worldFromLocal(ship, supportRLocal);
        const dL = terrainY(settledSkidL.x) - settledSkidL.y;
        const dR = terrainY(settledSkidR.x) - settledSkidR.y;
        const yAdjust = clamp((dL + dR) * 0.5, -0.12, 0.12);
        ship.y += yAdjust;
        ship.vy = 0;
      }
    }

    // Refuel only with safe skid landing on refuel pad.
    if (ship.landed) {
      const refuel = terrain.pads.find(p => p.kind === 'refuel' && Math.abs(ship.x - p.x) <= p.w * 0.45);
      if (refuel) ship.fuel = clamp(ship.fuel + 100 * dt, 0, 100);
    }
  }

  function updateCargo(dt) {
    const arm = getArmKinematics();
    const armDormant = ship.armFolded || ship.armFoldBlend >= 0.72;

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

      if (ship.clawOpen > 0.82 || armDormant) {
        if (c) c.grabbed = false;
        ship.grabbedCargo = null;
      }
    } else {
      // Pick when claw is mostly closed and target near tip.
      if (!armDormant && ship.clawOpen < 0.2) {
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
        const impactV = Math.abs(c.vy);
        c.y = gy;
        if (impactV > 0.52) playCargoThudSound(clamp(impactV * 0.55, 0.6, 3));
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

    function trayHasCapacity() {
      return ship.storedCargoIds.length < CONFIG.trayCapacity;
    }

    function bounceCargoOffTrayTop(c, tr) {
      const bounceLocal = {
        x: tr.x - c.r - 0.09,
        y: tr.y - c.r - 0.04,
      };
      const bounceWorld = worldFromLocal(ship, bounceLocal);
      c.x = bounceWorld.x;
      c.y = bounceWorld.y;
      const left = rotate({ x: -1, y: 0 }, ship.angle);
      const up = rotate({ x: 0, y: -1 }, ship.angle);
      c.vx = ship.vx + left.x * (1.5 + Math.random() * 0.8) + up.x * 0.35;
      c.vy = ship.vy + left.y * (1.5 + Math.random() * 0.8) + up.y * 0.95;
      c.ignoreTrayTimer = 0.9;
      c.restTimer = 0;
    }

    // Tray catch: dropped/free cargo that enters tray bounds is caught and stored.
    if (ship.traySlide > 0.55) for (const c of cargos) {
      if (c.scored || c.accepting || c.stored || c.grabbed || c.popping || c.ignoreTrayTimer > 0) continue;
      const local = rotate({ x: c.x - ship.x, y: c.y - ship.y }, -ship.angle);
      const tr = getTrayRect();
      const inTray = local.x > tr.x + c.r && local.x < tr.x + tr.w - c.r && local.y > tr.y + c.r && local.y < tr.y + tr.h - c.r;
      if (!inTray) continue;
      if (!trayHasCapacity()) {
        bounceCargoOffTrayTop(c, tr);
        continue;
      }
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
          if (!trayHasCapacity()) {
            c.grabbed = false;
            ship.grabbedCargo = null;
            bounceCargoOffTrayTop(c, tr);
          } else {
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


  function updateMultiplayer(dt) {
    if (!multiplayer.connected) return;
    multiplayer.pushTimer += dt;
    if (multiplayer.pushTimer < 1 / MULTIPLAYER.statePushHz) return;
    multiplayer.pushTimer = 0;
    sendSocketMessage('state-update', {
      x: ship.x,
      y: ship.y,
      angle: ship.angle,
      crashed: game.state === 'CRASHED',
      radioMessage: game.radioMessage.timer > 0 ? game.radioMessage.text : '',
    }).then((snapshot) => {
      if (!snapshot) return;
      multiplayer.others = new Map((snapshot.players || [])
        .filter((player) => player.playerId !== multiplayer.playerId)
        .map((player) => [player.playerId, player]));
      if (snapshot.collision && snapshot.collision.includes(multiplayer.playerId) && game.state !== 'CRASHED') {
        crashShip('ship-collision');
      }
    });
  }

  function toScreen(wx, wy) {
    const px = (wx - game.camera.x) * CONFIG.METER_TO_PX + W / 2;
    const py = (wy - game.camera.y) * CONFIG.METER_TO_PX + getViewCenterY();
    return { x: px, y: py };
  }

  function drawBackground() {
    ctx.fillStyle = '#02030b';
    ctx.fillRect(0, 0, W, H);

    // Animated background set pieces: floating ISS and decorative UFOs (visual only, non-interactive).
    const bgTime = performance.now() * 0.001;
    const shipDiameterPx = shipShape.hullRadius * CONFIG.METER_TO_PX * 2;

    const issScale = Math.max(0.8, Math.min(1.25, shipDiameterPx / 50));
    const issAnchorX = W * 0.57 - game.camera.x * 0.065 * CONFIG.METER_TO_PX;
    const issAnchorY = H * 0.1 - game.camera.y * 0.03 * CONFIG.METER_TO_PX;
    const issX = issAnchorX + Math.sin(bgTime * 0.17) * Math.min(42, W * 0.035) + Math.sin(bgTime * 0.071 + 1.4) * 14;
    const issY = issAnchorY + Math.cos(bgTime * 0.13 + 0.8) * Math.min(20, H * 0.025) + Math.sin(bgTime * 0.23) * 6;
    ctx.save();
    ctx.translate(issX, issY);
    ctx.rotate(Math.sin(bgTime * 0.2) * 0.06 - 0.08);
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = '#9fb0c7';
    ctx.fillRect(-8 * issScale, -3 * issScale, 16 * issScale, 6 * issScale);
    ctx.fillStyle = '#6d7f98';
    ctx.fillRect(-4 * issScale, -7 * issScale, 8 * issScale, 14 * issScale);
    ctx.fillStyle = '#4f7cc5';
    const panelW = 10 * issScale;
    const panelH = 33 * issScale;
    const panelGap = 1.8 * issScale;
    for (let i = 0; i < 4; i++) {
      const leftX = (-54 * issScale) + i * (panelW + panelGap);
      const rightX = (13 * issScale) + i * (panelW + panelGap);
      ctx.fillRect(leftX, -16.5 * issScale, panelW, panelH);
      ctx.fillRect(rightX, -16.5 * issScale, panelW, panelH);
    }
    ctx.strokeStyle = '#b9d5ff';
    ctx.lineWidth = 1.1;
    for (let i = 0; i < 4; i++) {
      const leftX = (-54 * issScale) + i * (panelW + panelGap);
      const rightX = (13 * issScale) + i * (panelW + panelGap);
      ctx.strokeRect(leftX, -16.5 * issScale, panelW, panelH);
      ctx.strokeRect(rightX, -16.5 * issScale, panelW, panelH);
    }
    ctx.restore();

    const ufoBaseScale = Math.max(0.76, Math.min(1.12, shipDiameterPx / 58));
    for (let i = 0; i < 4; i++) {
      const anchorX = W * (0.13 + i * 0.22) - game.camera.x * CONFIG.METER_TO_PX * (0.035 + i * 0.004);
      const anchorY = H * (0.16 + (i % 2) * 0.12 + i * 0.04) - game.camera.y * CONFIG.METER_TO_PX * 0.018;
      const bobX = Math.sin(bgTime * (0.11 + i * 0.02) + i * 1.7) * (24 + i * 8);
      const bobY = Math.cos(bgTime * (0.16 + i * 0.018) + i * 0.9) * (9 + i * 2.7);
      const x = anchorX + bobX;
      const y = anchorY + bobY;
      const scale = ufoBaseScale * (0.76 + (i % 3) * 0.17);

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.sin(bgTime * (0.45 + i * 0.07) + i) * 0.03);
      ctx.globalAlpha = 0.66;
      ctx.fillStyle = '#89f4ff';
      ctx.beginPath();
      ctx.ellipse(0, -2.4 * scale, 4.8 * scale, 2.2 * scale, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#a8b6d6';
      ctx.beginPath();
      ctx.ellipse(0, 0, 10.5 * scale, 3.3 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#dde6ff';
      ctx.beginPath();
      ctx.arc(-3.8 * scale, 0.2 * scale, 0.9 * scale, 0, Math.PI * 2);
      ctx.arc(0, 0.2 * scale, 0.9 * scale, 0, Math.PI * 2);
      ctx.arc(3.8 * scale, 0.2 * scale, 0.9 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = '#8cf5ff';
      ctx.beginPath();
      ctx.moveTo(-1.8 * scale, 2.1 * scale);
      ctx.lineTo(0, 9.8 * scale);
      ctx.lineTo(1.8 * scale, 2.1 * scale);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

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

    const starWrapW = W + 80;
    const starParallaxShift = game.camera.x * CONFIG.METER_TO_PX * 0.12;
    for (const s of stars) {
      const parallaxX = ((s.x - starParallaxShift + 40) % starWrapW + starWrapW) % starWrapW - 40;
      const parallaxY = s.y - game.camera.y * CONFIG.METER_TO_PX * 0.02;
      if (parallaxX < -4 || parallaxX > W + 4 || parallaxY < -6 || parallaxY > getGameplayHeight() + 6) continue;
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
    const trayVisualH = tr.h * 0.7; // 30% thinner drawer profile.
    const trayVisualY = tr.y + (tr.h - trayVisualH) * 0.5;
    const trayVisualW = shipShape.trayRect.w; // Keep drawer width fixed regardless of throttle/state.
    const trayEdgeW = Math.max(4, Math.min(7, 0.12 * m));

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(tr.x * m, trayVisualY * m, trayVisualW * m, trayVisualH * m);
    ctx.strokeStyle = '#18202c';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(tr.x * m, trayVisualY * m, trayVisualW * m, trayVisualH * m);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(tr.x * m, trayVisualY * m, trayEdgeW, trayVisualH * m);
    ctx.fillRect((tr.x + trayVisualW) * m - trayEdgeW, trayVisualY * m, trayEdgeW, trayVisualH * m);

    if (ship.traySlide > 0.2) {
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${Math.max(10, Math.floor(0.21 * m))}px "Segoe UI", Arial, sans-serif`;
      const trayLabelX = (tr.x + trayVisualW * 0.5) * m - ctx.measureText('  ').width;
      ctx.fillText('CARGO', trayLabelX, (trayVisualY + trayVisualH * 0.5) * m);
    }

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
    ctx.fillStyle = '#ffffff';
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

    // Side-profile front/rear windscreen windows (dark blue) with a thin white separator line.
    function drawWindscreen(points) {
      ctx.fillStyle = '#0d2b5c';
      ctx.beginPath();
      ctx.moveTo(points[0].x * m, points[0].y * m);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x * m, points[i].y * m);
      ctx.closePath();
      ctx.fill();

      // Thin white line separating glass from hull edge.
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.15;
      ctx.stroke();

      // Subtle reflection highlight.
      const hi = points[0];
      const hj = points[1];
      ctx.strokeStyle = 'rgba(180,220,255,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo((hi.x + (hj.x - hi.x) * 0.2) * m, (hi.y + 0.008) * m);
      ctx.lineTo((hi.x + (hj.x - hi.x) * 0.8) * m, (hj.y + 0.008) * m);
      ctx.stroke();
    }

    // Rear side window (left), similar to a car rear windscreen in side profile.
    drawWindscreen([
      { x: -0.64, y: -0.42 },
      { x: -0.18, y: -0.42 },
      { x: -0.24, y: -0.16 },
      { x: -0.58, y: -0.2 },
    ]);

    // Front side window (right), similar to a car front windscreen in side profile.
    drawWindscreen([
      { x: 0.16, y: -0.42 },
      { x: 0.62, y: -0.42 },
      { x: 0.55, y: -0.2 },
      { x: 0.22, y: -0.16 },
    ]);

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
    if (ship.armFolded && ship.armFoldBlend > 0.995) {
      // Fully stowed inside the ship bay.
      ctx.restore();
      return;
    }
    const base = { x: shipShape.craneBase.x, y: shipShape.craneBase.y + ship.armStowDrop * ARM_STOW_DROP_MAX };

    // While retracting into the ship, clip arm rendering above the bay lip so it reads as stowing inside.
    const loweringIntoShip = ship.armFoldBlend >= 0.72;
    if (loweringIntoShip) {
      ctx.save();
      ctx.beginPath();
      // Keep the whole upper arm visible while still hiding anything that drops below the bay lip.
      ctx.rect(-5.8 * m, -8.2 * m, 11.6 * m, (shipShape.craneBase.y - 0.02) * m + 8.2 * m);
      ctx.clip();
    }

    {
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
      // Rounded joins/caps prevent miter spikes from poking past the red joint circles.
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
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
    }

    if (loweringIntoShip) ctx.restore();

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




  function drawOtherShips() {
    for (const player of multiplayer.others.values()) {
      const center = toScreen(player.x, player.y);
      ctx.save();
      ctx.translate(center.x, center.y);
      ctx.rotate(player.angle || 0);
      const m = CONFIG.METER_TO_PX;
      ctx.fillStyle = '#9aa0aa';
      ctx.beginPath();
      ctx.moveTo(0, -0.95 * m);
      ctx.lineTo(0.9 * m, 0.5 * m);
      ctx.lineTo(-0.9 * m, 0.5 * m);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#3b4048';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawOtherShipRadioBubbles() {
    for (const player of multiplayer.others.values()) {
      if (!player.radioMessage) continue;
      const anchor = toScreen(player.x, player.y - 1.55);
      const bubbleW = 150;
      const bubbleH = 34;
      const bubbleX = clamp(anchor.x - bubbleW * 0.5, 8, W - bubbleW - 8);
      const bubbleY = Math.max(8, anchor.y - bubbleH - 1);

      ctx.fillStyle = '#e6e6e6';
      ctx.fillRect(bubbleX, bubbleY, bubbleW, bubbleH);
      ctx.strokeStyle = '#3f3f3f';
      ctx.strokeRect(bubbleX, bubbleY, bubbleW, bubbleH);
      ctx.fillStyle = '#111';
      ctx.font = '600 14px Segoe UI';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(player.radioMessage.slice(0, 30), bubbleX + bubbleW * 0.5, bubbleY + bubbleH * 0.5);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
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

    const innerW = W - 32;
    const uiScale = clamp(innerW / 1750, 0.56, 1);
    const pad = Math.floor(16 * uiScale);
    const gap = Math.max(6, Math.floor(12 * uiScale));
    const panelH = h - Math.max(12, Math.floor(24 * uiScale));
    const panelY = y + Math.max(6, Math.floor(12 * uiScale));

    function drawBar(x, w, label, value, unit = '%') {
      ctx.fillStyle = '#000';
      ctx.fillRect(x, panelY, w, panelH);
      ctx.strokeStyle = '#0b5';
      ctx.strokeRect(x, panelY, w, panelH);
      ctx.fillStyle = '#0f7d3a';
      const fillW = Math.max(0, Math.min(1, value)) * (w - 18);
      ctx.fillRect(x + 9, panelY + panelH * 0.55, fillW, panelH * 0.28);
      ctx.fillStyle = '#7dff9c';
      ctx.font = `bold ${Math.max(10, Math.floor(14 * uiScale))}px Segoe UI`;
      ctx.fillText(label, x + 8, panelY + Math.max(14, Math.floor(20 * uiScale)));
      ctx.font = `bold ${Math.max(11, Math.floor(18 * uiScale))}px Consolas, monospace`;
      ctx.fillText(`${Math.round(value * 100)}${unit}`, x + 8, panelY + Math.max(30, Math.floor(44 * uiScale)));
    }

    const panelWeights = {
      throttle: 1,
      fuel: 1,
      attitude: 1,
      speed: 1,
      weight: 1,
      distance: 1,
      radio: 2,
      map: 2,
      score: 1,
    };
    const panelCount = Object.keys(panelWeights).length;
    const totalUnits = Object.values(panelWeights).reduce((sum, units) => sum + units, 0);
    const availableW = Math.max(260, innerW - gap * (panelCount - 1));
    const unitW = availableW / totalUnits;
    const panelW = (units) => Math.max(52, unitW * units);

    const barW = panelW(panelWeights.throttle);
    const fuelW = panelW(panelWeights.fuel);
    const attitudePanelW = panelW(panelWeights.attitude);
    const speedW = panelW(panelWeights.speed);
    const weightW = panelW(panelWeights.weight);
    const distW = panelW(panelWeights.distance);
    const radioW = panelW(panelWeights.radio);
    const mapW = panelW(panelWeights.map);

    let cursorX = pad;

    drawBar(cursorX, barW, 'THROTTLE', ship.throttle);
    cursorX += barW + gap;

    const fuelX = cursorX;
    drawBar(fuelX, fuelW, 'FUEL', ship.fuel / 100);
    cursorX += fuelW + gap;

    const gaugeSize = clamp(Math.min(panelH - 8, attitudePanelW * 0.84), 36, 110);
    const attitudeX = cursorX;
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
    ctx.font = `bold ${Math.max(10, Math.floor(13 * uiScale))}px Segoe UI`;
    ctx.fillText('ATTITUDE', attitudeX + 8, panelY + 16);
    cursorX += attitudePanelW + gap;

    const speedX = cursorX;
    const sgx = speedX + speedW * 0.5;
    const sgy = panelY + panelH * 0.68;
    const speedMps = Math.hypot(ship.vx, ship.vy);
    const speedMax = 12;
    const safeLandingSpeed = CONFIG.landingMaxSpeed;
    const speedNorm = clamp(speedMps / speedMax, 0, 1);
    const safeNorm = clamp(safeLandingSpeed / speedMax, 0, 1);
    const redNorm = 0.84;
    const speedStartAng = Math.PI * (7 / 6); // 7 o'clock
    const speedEndAng = Math.PI * (11 / 6); // sweep clockwise toward top-right
    const safeAng = lerp(speedStartAng, speedEndAng, safeNorm);
    const redStartAng = lerp(speedStartAng, speedEndAng, redNorm);
    const speedAng = lerp(speedStartAng, speedEndAng, speedNorm);

    ctx.fillStyle = '#000';
    ctx.fillRect(speedX, panelY, speedW, panelH);
    ctx.strokeStyle = '#0b5';
    ctx.strokeRect(speedX, panelY, speedW, panelH);

    const speedRadius = gaugeSize * 0.36;
    // Safe landing band at low speed.
    ctx.strokeStyle = '#ffb347';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(sgx, sgy, speedRadius, speedStartAng, safeAng, false);
    ctx.stroke();
    // Normal operating speed range.
    ctx.strokeStyle = '#42d76d';
    ctx.beginPath();
    ctx.arc(sgx, sgy, speedRadius, safeAng, redStartAng, false);
    ctx.stroke();
    // Top-end danger speed range.
    ctx.strokeStyle = '#ff6464';
    ctx.beginPath();
    ctx.arc(sgx, sgy, speedRadius, redStartAng, speedEndAng, false);
    ctx.stroke();

    ctx.strokeStyle = '#7dff9c';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const a = lerp(speedStartAng, speedEndAng, t);
      const rOuter = speedRadius;
      const rInner = rOuter - gaugeSize * 0.055;
      ctx.beginPath();
      ctx.moveTo(sgx + Math.cos(a) * rInner, sgy + Math.sin(a) * rInner);
      ctx.lineTo(sgx + Math.cos(a) * rOuter, sgy + Math.sin(a) * rOuter);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(sgx, sgy);
    ctx.rotate(speedAng);
    ctx.strokeStyle = '#9ce8ff';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-gaugeSize * 0.04, 0);
    ctx.lineTo(gaugeSize * 0.28, 0);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#7dff9c';
    ctx.font = `bold ${Math.max(10, Math.floor(13 * uiScale))}px Segoe UI`;
    ctx.fillText('SPEED', speedX + 10, panelY + 16);
    ctx.font = `bold ${Math.max(10, Math.floor(14 * uiScale))}px "Consolas", monospace`;
    ctx.fillText(`${speedMps.toFixed(1)} m/s`, speedX + 10, panelY + panelH - 10);
    cursorX += speedW + gap;

    const weightX = cursorX;
    const wgx = weightX + weightW * 0.5;
    const wgy = panelY + panelH * 0.68;
    const maxCargoMass = CONFIG.trayCapacity * Math.max(...cargoTypes.map((t) => t.mass));
    const cargoCount = ship.storedCargoIds.length;
    const cargoCountNorm = clamp(cargoCount / CONFIG.trayCapacity, 0, 1);
    const cargoMassNorm = clamp(ship.cargoMass / Math.max(0.001, maxCargoMass), 0, 1);
    const weightNorm = clamp(Math.max(cargoCountNorm, cargoMassNorm), 0, 1);
    const weightStartAng = Math.PI * (7 / 6);
    const weightEndAng = Math.PI * (11 / 6);
    const weightAng = lerp(weightStartAng, weightEndAng, weightNorm);

    ctx.fillStyle = '#000';
    ctx.fillRect(weightX, panelY, weightW, panelH);
    ctx.strokeStyle = '#0b5';
    ctx.strokeRect(weightX, panelY, weightW, panelH);
    ctx.strokeStyle = '#7dff9c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(wgx, wgy, gaugeSize * 0.34, weightStartAng, weightEndAng, false);
    ctx.stroke();

    for (let i = 0; i <= CONFIG.trayCapacity; i++) {
      const t = i / CONFIG.trayCapacity;
      const a = lerp(weightStartAng, weightEndAng, t);
      const rOuter = gaugeSize * 0.34;
      const rInner = rOuter - gaugeSize * 0.05;
      ctx.beginPath();
      ctx.moveTo(wgx + Math.cos(a) * rInner, wgy + Math.sin(a) * rInner);
      ctx.lineTo(wgx + Math.cos(a) * rOuter, wgy + Math.sin(a) * rOuter);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(wgx, wgy);
    ctx.rotate(weightAng);
    ctx.strokeStyle = '#ffd18b';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-gaugeSize * 0.04, 0);
    ctx.lineTo(gaugeSize * 0.26, 0);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#7dff9c';
    ctx.font = `bold ${Math.max(10, Math.floor(13 * uiScale))}px Segoe UI`;
    ctx.fillText('WEIGHT', weightX + 10, panelY + 16);
    ctx.font = `bold ${Math.max(10, Math.floor(14 * uiScale))}px "Consolas", monospace`;
    ctx.fillText(`${shipMass().toFixed(2)} t`, weightX + 10, panelY + panelH - 24);
    ctx.fillText(`CARGO ${cargoCount}/${CONFIG.trayCapacity}`, weightX + 10, panelY + panelH - 8);
    cursorX += weightW + gap;

    const dX = cursorX;
    ctx.fillStyle = '#000';
    ctx.fillRect(dX, panelY, distW, panelH);
    ctx.strokeStyle = '#0b5';
    ctx.strokeRect(dX, panelY, distW, panelH);
    const dist = distanceToGroundMeters();
    ctx.fillStyle = '#7dff9c';
    ctx.font = `bold ${Math.max(10, Math.floor(15 * uiScale))}px Segoe UI`;
    ctx.fillText('DISTANCE TO GROUND', dX + 12, panelY + 22);
    ctx.font = `bold ${Math.max(16, Math.floor(44 * uiScale))}px "Consolas", monospace`;
    ctx.fillText(`${dist.toFixed(1)} m`, dX + 12, panelY + panelH * 0.72);
    cursorX += distW + gap;

    const radioX = cursorX;
    setRadioHudLayout(radioX, panelY, radioW, panelH, uiScale);
    cursorX += radioW + gap;

    const mapX = cursorX;
    drawMiniMapInPanel(mapX, panelY, mapW, panelH);
    cursorX += mapW + gap;

    const scoreX = cursorX;
    const scoreW = panelW(panelWeights.score);
    ctx.fillStyle = '#000';
    ctx.fillRect(scoreX, panelY, scoreW, panelH);
    ctx.strokeStyle = '#0b5';
    ctx.strokeRect(scoreX, panelY, scoreW, panelH);
    ctx.fillStyle = '#7dff9c';
    ctx.font = `bold ${Math.max(10, Math.floor(15 * uiScale))}px Segoe UI`;
    ctx.fillText('SCORE', scoreX + 12, panelY + 22);
    ctx.font = `bold ${Math.max(18, Math.floor(46 * uiScale))}px "Consolas", monospace`;
    ctx.fillText(`${game.score}`, scoreX + 12, panelY + panelH * 0.74);
  }




  function drawMiniMapInPanel(panelX, panelY, panelW, panelH) {
    const mapPadX = 8;
    const mapPadTop = 18;
    const mapPadBottom = 8;
    const mapX = panelX + mapPadX;
    const mapY = panelY + mapPadTop;
    const mapW = Math.max(60, panelW - mapPadX * 2);
    const mapH = Math.max(36, panelH - mapPadTop - mapPadBottom);
    const tm = terrainMetrics();
    const mapTopWorldY = tm.minY - tm.height * 2.2;
    const mapBottomWorldY = tm.maxY + 1.6;

    const mapWorldX = (x) => mapX + (x / CONFIG.worldWidth) * mapW;
    const mapWorldY = (y) => mapY + ((y - mapTopWorldY) / Math.max(0.01, mapBottomWorldY - mapTopWorldY)) * mapH;

    ctx.fillStyle = '#000';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = '#0b5';
    ctx.lineWidth = 2;
    ctx.strokeRect(panelX, panelY, panelW, panelH);

    // Terrain profile and fill.
    ctx.beginPath();
    const first = terrain.points[0];
    ctx.moveTo(mapWorldX(first.x), mapWorldY(first.y));
    for (const pt of terrain.points) ctx.lineTo(mapWorldX(pt.x), mapWorldY(pt.y));
    ctx.lineTo(mapX + mapW, mapY + mapH);
    ctx.lineTo(mapX, mapY + mapH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(110,120,138,0.55)';
    ctx.fill();

    ctx.strokeStyle = '#c5cfdf';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(mapWorldX(first.x), mapWorldY(first.y));
    for (const pt of terrain.points) ctx.lineTo(mapWorldX(pt.x), mapWorldY(pt.y));
    ctx.stroke();

    for (const pad of terrain.pads) {
      const px = mapWorldX(pad.x - pad.w * 0.5);
      const pw = Math.max(3, (pad.w / CONFIG.worldWidth) * mapW);
      const py = mapWorldY(pad.y) - 2;
      ctx.fillStyle = pad.kind === 'recycle' ? '#72ff95' : '#78d8ff';
      ctx.fillRect(px, py, pw, 4);
    }

    const shipX = mapWorldX(clamp(ship.x, 0, CONFIG.worldWidth));
    const shipY = mapWorldY(clamp(ship.y, mapTopWorldY, mapBottomWorldY));
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(shipX, shipY, 3.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();

    for (const player of multiplayer.others.values()) {
      const otherX = mapWorldX(clamp(player.x, 0, CONFIG.worldWidth));
      const otherY = mapWorldY(clamp(player.y, mapTopWorldY, mapBottomWorldY));
      ctx.fillStyle = '#9aa0aa';
      ctx.beginPath();
      ctx.arc(otherX, otherY, 3.1, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#7dff9c';
    ctx.font = 'bold 12px Segoe UI';
    ctx.textAlign = 'left';
    ctx.fillText('MINI MAP', panelX + 8, panelY + 14);
  }


  function drawMissionHelpPanel() {
    const baseScale = clamp(Math.min(W / 1600, H / 980), 0.52, 1.15);
    const panelW = clamp(W * 0.92, 540, 1260);
    const panelH = clamp(H * 0.9, 420, 880);
    const panelX = Math.floor((W - panelW) * 0.5);
    const panelY = Math.floor((H - panelH) * 0.5);

    let uiScale = baseScale;
    for (let i = 0; i < 7; i++) {
      const titleTry = Math.floor(clamp(44 * uiScale, 22, 56));
      const subtitleTry = Math.floor(clamp(24 * uiScale, 15, 32));
      const bodyTry = Math.floor(clamp(15 * uiScale, 10, 20));
      const sectionTry = Math.floor(clamp(18 * uiScale, 12, 24));
      const capHTry = Math.floor(clamp(36 * uiScale, 20, 44));
      const lineHTry = Math.floor(clamp(bodyTry * 1.3, 13, 26));
      const colPadTry = Math.floor(clamp(28 * uiScale, 12, 34));
      const footerLinesTry = 2;
      const estimatedStart = colPadTry + titleTry + subtitleTry + sectionTry * 3 + lineHTry * (3 + 4 + 4) + 90 * uiScale;
      const availableForControls = panelH - colPadTry - (lineHTry * footerLinesTry) - estimatedStart;
      const neededControls = 12 * (capHTry + Math.floor(clamp(8 * uiScale, 4, 9)));
      if (neededControls <= availableForControls) break;
      uiScale *= 0.9;
    }

    const titleSize = Math.floor(clamp(44 * uiScale, 22, 56));
    const subtitleSize = Math.floor(clamp(24 * uiScale, 15, 32));
    const bodySize = Math.floor(clamp(15 * uiScale, 10, 20));
    const sectionSize = Math.floor(clamp(18 * uiScale, 12, 24));
    const keyFont = Math.floor(clamp(14 * uiScale, 9, 19));

    const controls = [
      { keys: ['A', 'D'], text: 'Rotate the ship left or right while flying.' },
      { keys: ['W', 'S'], text: 'Increase or decrease engine throttle.' },
      { keys: ['SPACE'], text: 'Start mission, then open or close the cargo tray.' },
      { keys: ['I', 'K'], text: 'Rotate the arm base counterclockwise / clockwise.' },
      { keys: ['U', 'J'], text: 'Move arm segment 1 up / down.' },
      { keys: ['O', 'L'], text: 'Move arm segment 2 up / down.' },
      { keys: ['P', ';'], text: 'Close or open the claw to grab cargo.' },
      { keys: ['F'], text: 'Fold arm down for flight / unfold arm for cargo use.' },
      { keys: ['E'], text: 'Extend or retract landing gear (2-second movement).' },
      { keys: ['Q'], text: 'Toggle track mode when landed and stable.' },
      { keys: ['H'], text: 'Show/hide this help panel.' },
      { keys: ['ESC'], text: 'Pause/unpause.' },
    ];

    const storyBlurb = [
      'Trash Bugs keep dumping junk across the lunar surface, and every new wave makes the Moon a little messier.',
      'You are the pilot of Space Recycle Hero, hauling debris before the bugs bury the outposts in scrap.',
      'Grab cargo, sort it, and keep your landings steady to save the Moon one load at a time.',
    ];

    const howToPlay = [
      'Collect trash pieces with the arm and claw.',
      'Deliver cargo to recycle pads to score points.',
      'Refuel at refuel pads to stay in the mission.',
      'Land gently on skids for stability.',
    ];

    const tips = [
      'Keep the tray closed in rough movement so cargo does not spill.',
      'Soft touchdowns prevent crashes and give you cleaner pickups.',
      'Use track mode when landed and stable for precise ground movement.',
      'If your tray is full, offload before collecting more debris.',
    ];

    function roundedRectPath(x, y, w, h, r) {
      const rr = Math.min(r, w * 0.5, h * 0.5);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    }

    function getWrappedLines(text, maxW, font = `500 ${bodySize}px Segoe UI`) {
      ctx.font = font;
      const words = text.split(' ');
      const lines = [];
      let line = '';
      for (const w of words) {
        const probe = line ? `${line} ${w}` : w;
        if (ctx.measureText(probe).width > maxW && line) {
          lines.push(line);
          line = w;
        } else line = probe;
      }
      if (line) lines.push(line);
      return lines;
    }

    function drawWrappedText(text, x, y, maxW, lineH, color = '#d9e7f8', font = `500 ${bodySize}px Segoe UI`, align = 'left') {
      const lines = getWrappedLines(text, maxW, font);
      ctx.font = font;
      ctx.fillStyle = color;

      let yy = y;
      if (align === 'right') {
        ctx.textAlign = 'right';
        for (const ln of lines) {
          ctx.fillText(ln, x + maxW, yy);
          yy += lineH;
        }
      } else {
        ctx.textAlign = 'left';
        for (const ln of lines) {
          ctx.fillText(ln, x, yy);
          yy += lineH;
        }
      }
      return yy;
    }

    function drawKeycaps(keys, x, y) {
      const capH = Math.floor(clamp(36 * uiScale, 22, 46));
      const padX = Math.floor(clamp(14 * uiScale, 8, 16));
      const radius = Math.floor(clamp(10 * uiScale, 6, 12));
      const sepW = Math.floor(clamp(24 * uiScale, 14, 30));
      let cx = x;
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        ctx.font = `700 ${keyFont}px Segoe UI`;
        const capW = Math.max(capH, Math.ceil(ctx.measureText(k).width + padX * 2));

        roundedRectPath(cx, y, capW, capH, radius);
        ctx.fillStyle = 'rgba(18,24,38,0.9)';
        ctx.fill();
        roundedRectPath(cx + 1, y + 1, capW - 2, capH * 0.45, Math.max(3, radius - 2));
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.4;
        roundedRectPath(cx, y, capW, capH, radius);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(k, cx + capW * 0.5, y + capH * 0.52);

        cx += capW;
        if (i < keys.length - 1) {
          ctx.font = `700 ${Math.max(10, keyFont - 1)}px Segoe UI`;
          ctx.fillStyle = '#bfd0e8';
          ctx.fillText(' / ', cx + sepW * 0.5, y + capH * 0.52);
          cx += sepW;
        }
      }
      return { width: cx - x, height: capH };
    }

    // Backdrop + vignette
    const vignette = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.2, W * 0.5, H * 0.5, Math.max(W, H) * 0.65);
    vignette.addColorStop(0, 'rgba(2,7,14,0.35)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.78)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);

    roundedRectPath(panelX, panelY, panelW, panelH, Math.floor(clamp(22 * uiScale, 12, 28)));
    ctx.fillStyle = 'rgba(8, 14, 24, 0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(180, 205, 235, 0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();

    const colPad = Math.floor(clamp(28 * uiScale, 14, 36));
    const contentX = panelX + colPad;
    const contentW = panelW - colPad * 2;
    let y = panelY + colPad;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${titleSize}px Segoe UI`;
    ctx.fillText('SPACE RECYCLE HERO', contentX, y);
    y += titleSize + Math.floor(clamp(6 * uiScale, 4, 10));

    ctx.fillStyle = '#9ce8ff';
    ctx.font = `700 ${subtitleSize}px Segoe UI`;
    ctx.fillText('MISSION CONTROLS', contentX, y);
    y += subtitleSize + Math.floor(clamp(10 * uiScale, 8, 14));

    ctx.strokeStyle = 'rgba(120, 170, 220, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(contentX, y);
    ctx.lineTo(contentX + contentW, y);
    ctx.stroke();
    y += Math.floor(clamp(14 * uiScale, 10, 18));

    const lineH = Math.floor(clamp(bodySize * 1.35, 15, 30));
    for (const line of storyBlurb) {
      y = drawWrappedText(line, contentX, y, contentW, lineH);
    }
    y += Math.floor(clamp(8 * uiScale, 6, 12));

    function drawBulletSection(title, bullets) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${sectionSize}px Segoe UI`;
      ctx.fillText(title, contentX, y);
      y += sectionSize + Math.floor(clamp(5 * uiScale, 4, 9));

      for (const b of bullets) {
        ctx.fillStyle = '#8ce5ff';
        ctx.font = `700 ${Math.max(10, bodySize)}px Segoe UI`;
        ctx.fillText('•', contentX, y + 1);
        y = drawWrappedText(b, contentX + Math.floor(clamp(16 * uiScale, 10, 20)), y, contentW - Math.floor(clamp(16 * uiScale, 10, 20)), lineH, '#d9e7f8', `500 ${bodySize}px Segoe UI`);
      }
      y += Math.floor(clamp(6 * uiScale, 4, 10));
    }

    drawBulletSection('How to Play', howToPlay);
    drawBulletSection('Tips', tips);

    ctx.strokeStyle = 'rgba(120, 170, 220, 0.45)';
    ctx.beginPath();
    ctx.moveTo(contentX, y);
    ctx.lineTo(contentX + contentW, y);
    ctx.stroke();
    y += Math.floor(clamp(14 * uiScale, 10, 18));

    // Controls grid
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${sectionSize}px Segoe UI`;
    ctx.fillText('Controls', contentX, y);
    y += sectionSize + Math.floor(clamp(8 * uiScale, 6, 12));

    const keyColW = clamp(contentW * 0.34, 170, 310);
    const descX = contentX + keyColW + Math.floor(clamp(16 * uiScale, 10, 24));
    const descW = contentW - keyColW - Math.floor(clamp(16 * uiScale, 10, 24));

    for (const row of controls) {
      const cap = drawKeycaps(row.keys, contentX, y);
      const descLineH = Math.floor(clamp(bodySize * 1.3, 14, 28));
      const descFont = `600 ${bodySize}px Segoe UI`;
      const descLines = getWrappedLines(row.text, descW, descFont);
      const descBlockH = descLines.length * descLineH;
      const descY = y + Math.max(0, Math.floor((cap.height - descBlockH) * 0.5));
      const descYEnd = drawWrappedText(row.text, descX, descY, descW, descLineH, '#f0f5ff', descFont, 'left');
      y = Math.max(y + cap.height, descYEnd) + Math.floor(clamp(8 * uiScale, 5, 10));
    }

    const footerLineH = Math.floor(clamp(bodySize * 1.3, 14, 28));
    const footerText = 'Land gently on skids, refuel pads refill fuel, and recycle pads score delivered cargo.';
    ctx.font = `600 ${bodySize}px Segoe UI`;
    const footerWords = footerText.split(' ');
    let footerLines = 1;
    let probeLine = '';
    for (const word of footerWords) {
      const nextProbe = probeLine ? `${probeLine} ${word}` : word;
      if (ctx.measureText(nextProbe).width > contentW && probeLine) {
        footerLines += 1;
        probeLine = word;
      } else {
        probeLine = nextProbe;
      }
    }

    const footerY = panelY + panelH - colPad - footerLineH * footerLines;
    drawWrappedText(footerText, contentX, footerY, contentW, footerLineH, '#bfe8c8', `600 ${bodySize}px Segoe UI`);
  }



  function drawShipRadioBubble() {
    if (game.radioMessage.timer <= 0 || !game.radioMessage.text || game.state === 'CRASHED') return;

    const anchor = toScreen(ship.x, ship.y - 1.55);
    const maxWidth = Math.max(120, Math.min(260, W * 0.35));
    const fontSize = 15;
    ctx.font = `600 ${fontSize}px Segoe UI`;

    const words = game.radioMessage.text.split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth - 24 && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);

    const bubbleW = Math.max(120, Math.min(maxWidth, Math.max(...lines.map((text) => ctx.measureText(text).width)) + 24));
    const lineH = 18;
    const bubbleH = Math.max(34, lines.length * lineH + 16);
    const bubbleX = clamp(anchor.x - bubbleW * 0.5, 8, W - bubbleW - 8);
    const bubbleY = Math.max(8, anchor.y - bubbleH - 1);

    const radius = 10;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(bubbleX + radius, bubbleY);
    ctx.lineTo(bubbleX + bubbleW - radius, bubbleY);
    ctx.quadraticCurveTo(bubbleX + bubbleW, bubbleY, bubbleX + bubbleW, bubbleY + radius);
    ctx.lineTo(bubbleX + bubbleW, bubbleY + bubbleH - radius);
    ctx.quadraticCurveTo(bubbleX + bubbleW, bubbleY + bubbleH, bubbleX + bubbleW - radius, bubbleY + bubbleH);
    ctx.lineTo(bubbleX + bubbleW * 0.54, bubbleY + bubbleH);
    ctx.lineTo(anchor.x + 4, bubbleY + bubbleH + 10);
    ctx.lineTo(bubbleX + bubbleW * 0.46, bubbleY + bubbleH);
    ctx.lineTo(bubbleX + radius, bubbleY + bubbleH);
    ctx.quadraticCurveTo(bubbleX, bubbleY + bubbleH, bubbleX, bubbleY + bubbleH - radius);
    ctx.lineTo(bubbleX, bubbleY + radius);
    ctx.quadraticCurveTo(bubbleX, bubbleY, bubbleX + radius, bubbleY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#0f0f0f';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((text, index) => {
      const y = bubbleY + 8 + lineH * (index + 0.5);
      ctx.fillText(text, bubbleX + bubbleW * 0.5, y + 4);
    });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
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
      drawMissionHelpPanel();
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
      if (game.radioMessage.timer > 0) game.radioMessage.timer = Math.max(0, game.radioMessage.timer - dt);
      updateMultiplayer(dt);
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
    drawOtherShips();
    if (game.state !== 'CRASHED') drawShip();
    drawOtherShipRadioBubbles();
    drawShipRadioBubble();
    drawExplosions();
    drawHUD();

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();
