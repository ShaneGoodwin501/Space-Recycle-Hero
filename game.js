(() => {
  'use strict';

  // =========================
  // Tunable constants
  // =========================
  const CONFIG = {
    METER_TO_PX: 40,
    gravity: 1.62,
    thrustMax: 32,
    torqueAccel: 2.8,
    angularDamping: 0.35,
    linearDamping: 0.02,

    throttleRampPerSec: 0.25,
    fuelBurnBase: 0.08,
    fuelBurnByThrottle: 0.55,

    landingMaxAngleDeg: 15,
    landingMaxVY: 2.0,
    landingMaxSpeed: 2.4,
    landingBounceVY: 3.4,
    landingCrashVY: 5.6,

    clawRate: 0.7,
    baseRate: 95 * Math.PI / 180,
    seg1Rate: 110 * Math.PI / 180,
    seg2Rate: 110 * Math.PI / 180,

    worldWidth: 260,
    terrainStep: 2,
    starCount: 240,

    cameraSmooth: 4,

    respawnSeconds: 2,

    cargoCount: 16,
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
  window.addEventListener('resize', resize);
  resize();

  const keys = new Set();
  const blocked = new Set(['KeyW','KeyA','KeyS','KeyD','Numpad1','Numpad2','Numpad3','Numpad4','Numpad6','Numpad7','Numpad8','Numpad9','Digit1','Digit2','Digit3','Digit4','Digit6','Digit7','Digit8','Digit9','Space','Escape','KeyH']);
  window.addEventListener('keydown', (e) => {
    if (blocked.has(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.code === 'Space' && game.state === 'READY') {
      game.state = 'PLAYING';
      game.showHelp = false;
    }
    if (e.code === 'KeyH') game.showHelp = !game.showHelp;
    if (e.code === 'Escape' && game.state !== 'CRASHED' && game.state !== 'READY') game.paused = !game.paused;
  }, { passive: false });
  window.addEventListener('keyup', (e) => {
    if (blocked.has(e.code)) e.preventDefault();
    keys.delete(e.code);
  }, { passive: false });

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

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

    for (let i = 0; i < 3; i++) {
      const x = 35 + i * 70 + (Math.random() * 8 - 4);
      const yPad = sampleHeightRaw(points, x) - 0.6;
      flattenAt(x, 6, yPad);
      pads.push({ kind: 'recycle', x, y: yPad, w: 11, h: 1.4 });
    }
    for (let i = 0; i < 2; i++) {
      const x = 65 + i * 110 + (Math.random() * 6 - 3);
      const yPad = sampleHeightRaw(points, x) - 0.4;
      flattenAt(x, 5.5, yPad);
      pads.push({ kind: 'refuel', x, y: yPad, w: 10, h: 1.4 });
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

  const terrain = generateTerrain();
  const stars = Array.from({ length: CONFIG.starCount }, () => ({
    x: Math.random() * CONFIG.worldWidth,
    y: Math.random() * 45,
    r: Math.random() * 1.7 + 0.2,
    a: Math.random() * 0.7 + 0.2,
  }));

  function terrainY(x) {
    return sampleHeightRaw(terrain.points, clamp(x, 0, CONFIG.worldWidth));
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
    seg1Angle: 2.2,
    seg2Angle: 1.6,
    clawOpen: 1,

    grabbedCargo: null,
    storedCargoIds: [],
  };

  function shipMass() {
    return ship.massBase + ship.cargoMass;
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
    trayRect: { x: -1.6, y: -0.45, w: 1.1, h: 0.9 },
    craneBase: { x: 0, y: -0.92 },
  };

  const cargoTypes = [
    { name: 'small', r: 0.28, mass: 0.17, points: 50, color: '#9baec7' },
    { name: 'medium', r: 0.38, mass: 0.3, points: 100, color: '#88a0b9' },
    { name: 'large', r: 0.52, mass: 0.46, points: 200, color: '#c2a96e' },
  ];

  const cargos = [];
  function spawnCargo() {
    for (let i = 0; i < CONFIG.cargoCount; i++) {
      const type = cargoTypes[Math.floor(Math.random() * cargoTypes.length)];
      const x = 22 + Math.random() * (CONFIG.worldWidth - 36);
      const y = terrainY(x) - 0.9 - Math.random() * 2.4;
      cargos.push({
        id: `c${i}`,
        x, y,
        vx: 0,
        vy: 0,
        angle: Math.random() * Math.PI,
        av: 0,
        r: type.r,
        mass: type.mass,
        points: type.points,
        color: type.color,
        type: type.name,
        grabbed: false,
        stored: false,
        scored: false,
        accepting: false,
        acceptedTimer: 0,
        targetX: 0,
        targetY: 0,
        restTimer: 0,
        localPos: { x: 0, y: 0 },
      });
    }
  }
  spawnCargo();

  const game = {
    score: 0,
    showHelp: true,
    paused: false,
    state: 'READY',
    camera: { x: ship.x, y: ship.y - 6 },
    explosions: [],
    crunchFx: [],
  };

  function setShipOnGround() {
    const skidL = worldFromLocal(ship, shipShape.skidL);
    const skidR = worldFromLocal(ship, shipShape.skidR);
    const gyL = terrainY(skidL.x);
    const gyR = terrainY(skidR.x);
    ship.y += Math.min(gyL - skidL.y, gyR - skidR.y);
    ship.vx = 0;
    ship.vy = 0;
    ship.av = 0;
    ship.landed = true;
  }

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
    const seg1Len = 0.95;
    const seg2Len = 0.85;
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
    ship.seg1Angle = 2.2;
    ship.seg2Angle = 1.6;
    ship.clawOpen = 1;
    ship.grabbedCargo = null;
    ship.storedCargoIds = [];
    ship.cargoMass = 0;
    setShipOnGround();
    game.camera.x = ship.x;
    game.camera.y = ship.y - 6;
    game.state = 'READY';
  }

  function updateInput(dt) {
    if (keys.has('KeyA')) ship.av -= CONFIG.torqueAccel * dt;
    if (keys.has('KeyD')) ship.av += CONFIG.torqueAccel * dt;

    if (keys.has('KeyW')) ship.throttle = clamp(ship.throttle + CONFIG.throttleRampPerSec * dt, 0, 1);
    if (keys.has('KeyS')) ship.throttle = clamp(ship.throttle - CONFIG.throttleRampPerSec * dt, 0, 1);

    const num = (a, b) => keys.has(a) || keys.has(b);
    if (num('Numpad4','Digit4')) ship.baseAngle -= CONFIG.baseRate * dt;
    if (num('Numpad6','Digit6')) ship.baseAngle += CONFIG.baseRate * dt;
    if (num('Numpad8','Digit8')) ship.seg1Angle += CONFIG.seg1Rate * dt;
    if (num('Numpad2','Digit2')) ship.seg1Angle -= CONFIG.seg1Rate * dt;
    if (num('Numpad7','Digit7')) ship.seg2Angle += CONFIG.seg2Rate * dt;
    if (num('Numpad1','Digit1')) ship.seg2Angle -= CONFIG.seg2Rate * dt;
    if (num('Numpad9','Digit9')) ship.clawOpen = clamp(ship.clawOpen - CONFIG.clawRate * dt, 0, 1);
    if (num('Numpad3','Digit3')) ship.clawOpen = clamp(ship.clawOpen + CONFIG.clawRate * dt, 0, 1);

    ship.baseAngle = clamp(ship.baseAngle, -120 * Math.PI/180, 120 * Math.PI/180);
    ship.seg1Angle = clamp(ship.seg1Angle, 0.3, 2.8);
    ship.seg2Angle = clamp(ship.seg2Angle, -0.35, 2.8);
  }

  function updateShip(dt) {
    const mass = shipMass();

    const flying = !ship.landed || ship.throttle > 0.02 || Math.hypot(ship.vx, ship.vy) > 0.4;
    if (flying) {
      const burn = (CONFIG.fuelBurnBase + CONFIG.fuelBurnByThrottle * ship.throttle) * dt;
      ship.fuel = clamp(ship.fuel - burn, 0, 100);
    }

    let thrust = 0;
    if (ship.fuel > 0) thrust = CONFIG.thrustMax * ship.throttle;

    const thrustDir = rotate({ x: 0, y: -1 }, ship.angle);
    ship.vx += (thrustDir.x * thrust / mass) * dt;
    ship.vy += (CONFIG.gravity + thrustDir.y * thrust / mass) * dt;

    ship.vx *= Math.exp(-CONFIG.linearDamping * dt);
    ship.vy *= Math.exp(-CONFIG.linearDamping * dt);
    ship.av *= Math.exp(-CONFIG.angularDamping * dt);

    ship.angle += ship.av * dt;
    ship.x += ship.vx * dt;
    ship.y += ship.vy * dt;

    ship.x = clamp(ship.x, 0.8, CONFIG.worldWidth - 0.8);

    const skidL = worldFromLocal(ship, shipShape.skidL);
    const skidR = worldFromLocal(ship, shipShape.skidR);
    const hullCenter = { x: ship.x, y: ship.y };

    for (const c of cargos) {
      if (c.scored || c.accepting || c.stored || c.grabbed) continue;
      if (Math.hypot(c.x - hullCenter.x, c.y - hullCenter.y) < c.r + shipShape.hullRadius * 0.8) {
        return crashShip('hull-cargo');
      }
    }

    const skidLContact = skidL.y >= terrainY(skidL.x);
    const skidRContact = skidR.y >= terrainY(skidR.x);

    const angleOk = Math.abs(ship.angle) < CONFIG.landingMaxAngleDeg * Math.PI / 180;
    const speed = Math.hypot(ship.vx, ship.vy);
    const verticalOk = Math.abs(ship.vy) < CONFIG.landingMaxVY;
    const speedOk = speed < CONFIG.landingMaxSpeed;

    const hasSkid = skidLContact || skidRContact;
    if (hasSkid && !angleOk) {
      return crashShip('bad-landing');
    }

    if (hasSkid && angleOk && Math.abs(ship.vy) > CONFIG.landingMaxVY && Math.abs(ship.vy) <= CONFIG.landingBounceVY) {
      ship.vy = -Math.abs(ship.vy) * 0.28;
      ship.vx *= 0.84;
      ship.av *= 0.7;
    }

    if (hasSkid && Math.abs(ship.vy) > CONFIG.landingCrashVY) return crashShip('hard-impact');

    let hullHitTerrain = false;
    for (const p of shipShape.hullPoints) {
      const w = worldFromLocal(ship, p);
      if (w.y > terrainY(w.x) - 0.02) {
        hullHitTerrain = true;
        break;
      }
    }
    if (hullHitTerrain && !hasSkid) return crashShip('hull-terrain');

    ship.landed = hasSkid && angleOk && speedOk && verticalOk;
    if (ship.landed) {
      ship.vy = Math.min(ship.vy, 0);
      ship.vx *= 0.93;
      ship.av *= 0.85;
      const ground = Math.min(terrainY(skidL.x) - shipShape.skidL.y, terrainY(skidR.x) - shipShape.skidR.y);
      ship.y = Math.min(ship.y, ground);
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

    // Gravity + collision for free cargo
    for (const c of cargos) {
      if (c.scored || c.accepting || c.stored || c.grabbed) continue;
      c.vy += CONFIG.gravity * dt;
      c.vx *= 0.995;
      c.vy *= 0.995;
      c.av *= 0.99;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.angle += c.av * dt;

      c.x = clamp(c.x, c.r, CONFIG.worldWidth - c.r);
      const gy = terrainY(c.x) - c.r;
      if (c.y > gy) {
        c.y = gy;
        if (Math.abs(c.vy) > 0.3) c.vy *= -0.22;
        else c.vy = 0;
        c.vx *= 0.88;
      }

      const speed = Math.hypot(c.vx, c.vy);
      if (speed < 0.2) c.restTimer += dt;
      else c.restTimer = 0;
    }

    // Tray storage: if grabbed cargo is lowered into tray and ship is landed/slow, snap store.
    if (ship.grabbedCargo) {
      const c = cargos.find(k => k.id === ship.grabbedCargo);
      if (c) {
        const local = rotate({ x: c.x - ship.x, y: c.y - ship.y }, -ship.angle);
        const tr = shipShape.trayRect;
        const inTray = local.x > tr.x && local.x < tr.x + tr.w && local.y > tr.y && local.y < tr.y + tr.h;
        const slow = Math.hypot(ship.vx, ship.vy) < 1.0;
        if (inTray && (ship.landed || slow)) {
          c.grabbed = false;
          c.stored = true;
          c.localPos = { x: clamp(local.x, tr.x + c.r, tr.x + tr.w - c.r), y: clamp(local.y, tr.y + c.r, tr.y + tr.h - c.r) };
          ship.grabbedCargo = null;
          ship.storedCargoIds.push(c.id);
          ship.cargoMass += c.mass;
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

    // Delivery: when safely landed on recycle pad, unload tray cargo onto drop zone.
    if (ship.landed) {
      const pad = terrain.pads.find(p => p.kind === 'recycle' && Math.abs(ship.x - p.x) <= p.w * 0.5);
      if (pad && ship.storedCargoIds.length > 0) {
        const ids = [...ship.storedCargoIds];
        ship.storedCargoIds = [];
        ship.cargoMass = 0;
        ids.forEach((id, i) => {
          const c = cargos.find(k => k.id === id);
          if (!c || c.scored || c.accepting) return;
          c.stored = false;
          c.grabbed = false;
          c.x = pad.x - 1 + i * 0.55;
          c.y = pad.y - 1.1;
          c.vx = (Math.random() - 0.5) * 0.4;
          c.vy = 0;
          c.restTimer = 0;
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
    const leftBound = game.camera.x - viewW * 0.25;
    const rightBound = game.camera.x + viewW * 0.25;
    let targetX = game.camera.x;

    // Camera dead-zone: follow only when ship enters left/right quarter bounds.
    if (ship.x < leftBound) targetX = ship.x + viewW * 0.25;
    if (ship.x > rightBound) targetX = ship.x - viewW * 0.25;

    const minX = viewW * 0.5;
    const maxX = CONFIG.worldWidth - viewW * 0.5;
    targetX = clamp(targetX, minX, maxX);

    const targetY = clamp(ship.y - 5.2, 5, 24);
    game.camera.x = lerp(game.camera.x, targetX, clamp(CONFIG.cameraSmooth * dt, 0, 1));
    game.camera.y = lerp(game.camera.y, targetY, clamp(3 * dt, 0, 1));
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
    const py = (wy - game.camera.y) * CONFIG.METER_TO_PX + H / 2;
    return { x: px, y: py };
  }

  function drawBackground() {
    ctx.fillStyle = '#02030b';
    ctx.fillRect(0, 0, W, H);

    for (const s of stars) {
      const parallaxX = (s.x - game.camera.x * 0.12) * CONFIG.METER_TO_PX + W / 2;
      const parallaxY = (s.y - game.camera.y * 0.05) * CONFIG.METER_TO_PX * 0.25 + 40;
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
    ctx.beginPath();
    const first = toScreen(terrain.points[0].x, terrain.points[0].y);
    ctx.moveTo(first.x, first.y);
    for (const p of terrain.points) {
      const s = toScreen(p.x, p.y);
      ctx.lineTo(s.x, s.y);
    }
    const last = terrain.points[terrain.points.length - 1];
    const end = toScreen(last.x, last.y);
    ctx.lineTo(end.x, H + 30);
    ctx.lineTo(first.x, H + 30);
    ctx.closePath();
    ctx.fillStyle = '#3c3f4a';
    ctx.fill();

    for (const pad of terrain.pads) {
      const left = toScreen(pad.x - pad.w / 2, pad.y);
      const right = toScreen(pad.x + pad.w / 2, pad.y);

      ctx.strokeStyle = pad.kind === 'recycle' ? '#6cff9f' : '#66d7ff';
      ctx.lineWidth = 4;
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
    ctx.beginPath();
    if (c.type === 'small') {
      ctx.rect(-r * 0.9, -r * 0.5, r * 1.8, r);
    } else if (c.type === 'medium') {
      ctx.moveTo(-r, -r * 0.7); ctx.lineTo(r, -r * 0.2); ctx.lineTo(r * 0.7, r); ctx.lineTo(-r * 0.8, r * 0.7); ctx.closePath();
    } else {
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.moveTo(-r * 0.8, -r * 0.2); ctx.lineTo(r * 0.8, r * 0.2);
    }
    ctx.fill();
    ctx.strokeStyle = '#101217';
    ctx.lineWidth = 2;
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
    if (flame > 0.02) {
      ctx.strokeStyle = '#ffbf66';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, shipShape.thruster.y * m + 10);
      ctx.lineTo((Math.random() - 0.5) * 6, shipShape.thruster.y * m + 14 + flame * 38);
      ctx.stroke();
    }

    // Tray (same color as hull for visual continuity)
    ctx.fillStyle = '#d5dbe6';
    ctx.fillRect(shipShape.trayRect.x * m, shipShape.trayRect.y * m, shipShape.trayRect.w * m, shipShape.trayRect.h * m);
    ctx.strokeStyle = '#18202c';
    ctx.strokeRect(shipShape.trayRect.x * m, shipShape.trayRect.y * m, shipShape.trayRect.w * m, shipShape.trayRect.h * m);
    ctx.fillStyle = '#d5dbe6';
    ctx.fillRect(shipShape.trayRect.x * m, shipShape.trayRect.y * m, 5, shipShape.trayRect.h * m);
    ctx.fillRect((shipShape.trayRect.x + shipShape.trayRect.w) * m - 5, shipShape.trayRect.y * m, 5, shipShape.trayRect.h * m);

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

    // Skids (safe landing colliders)
    ctx.strokeStyle = '#73ffcf';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo((shipShape.skidL.x - 0.22) * m, shipShape.skidL.y * m);
    ctx.lineTo((shipShape.skidL.x + 0.22) * m, shipShape.skidL.y * m);
    ctx.moveTo((shipShape.skidR.x - 0.22) * m, shipShape.skidR.y * m);
    ctx.lineTo((shipShape.skidR.x + 0.22) * m, shipShape.skidR.y * m);
    ctx.stroke();

    // Crane segments
    const base = shipShape.craneBase;
    const bAng = -Math.PI / 2 + ship.baseAngle;
    const seg1Len = 0.95;
    const seg2Len = 0.85;
    const p1 = { x: base.x + Math.cos(bAng) * seg1Len, y: base.y + Math.sin(bAng) * seg1Len };
    const a1 = bAng + (ship.seg1Angle - Math.PI / 2);
    const p2 = { x: p1.x + Math.cos(a1) * seg2Len, y: p1.y + Math.sin(a1) * seg2Len };
    const a2 = a1 + (ship.seg2Angle - Math.PI / 2);

    ctx.strokeStyle = '#ffcc66';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(base.x * m, base.y * m);
    ctx.lineTo(p1.x * m, p1.y * m);
    ctx.lineTo(p2.x * m, p2.y * m);
    ctx.stroke();

    // Claw (dual triangular fingers, ratchet open/close variable)
    const open = lerp(0.05, 0.52, ship.clawOpen);
    const tip = { x: p2.x + Math.cos(a2) * 0.28, y: p2.y + Math.sin(a2) * 0.28 };
    const n = { x: Math.cos(a2 + Math.PI / 2), y: Math.sin(a2 + Math.PI / 2) };
    const forward = { x: Math.cos(a2), y: Math.sin(a2) };

    function drawFinger(sign) {
      const baseP = { x: tip.x + n.x * open * sign, y: tip.y + n.y * open * sign };
      const pA = { x: baseP.x + forward.x * 0.2, y: baseP.y + forward.y * 0.2 };
      const pB = { x: baseP.x + n.x * 0.1 * sign, y: baseP.y + n.y * 0.1 * sign };
      ctx.fillStyle = '#f3f5fa';
      ctx.beginPath();
      ctx.moveTo(baseP.x * m, baseP.y * m);
      ctx.lineTo(pA.x * m, pA.y * m);
      ctx.lineTo(pB.x * m, pB.y * m);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#1b1f28';
      ctx.stroke();
    }
    drawFinger(1);
    drawFinger(-1);

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

  function drawHUD() {
    ctx.fillStyle = '#dce7ff';
    ctx.font = 'bold 24px Segoe UI';
    ctx.fillText(`Score: ${game.score}`, 20, 34);

    ctx.font = '16px Segoe UI';
    ctx.fillText(`Throttle: ${Math.round(ship.throttle * 100)}%`, 20, 58);
    ctx.fillText(`Mass: ${shipMass().toFixed(2)} t`, 20, 80);

    if (ship.landed && game.state === 'PLAYING') {
      ctx.fillStyle = '#7dffad';
      ctx.fillText('LANDED', 20, 102);
    }

    // Fuel gauge on right
    const gx = W - 52;
    const gy = 90;
    const gh = Math.min(320, H * 0.55);
    ctx.fillStyle = '#101522';
    ctx.fillRect(gx, gy, 24, gh);
    ctx.strokeStyle = '#8eb8ff';
    ctx.strokeRect(gx, gy, 24, gh);
    const fill = gh * (ship.fuel / 100);
    ctx.fillStyle = ship.fuel < 20 ? '#ff5f5f' : '#73ffd9';
    ctx.fillRect(gx + 2, gy + gh - fill + 2, 20, fill - 4);
    ctx.fillStyle = '#dce7ff';
    ctx.font = '15px Segoe UI';
    ctx.fillText('FUEL', gx - 8, gy - 10);
    ctx.fillText(`${Math.round(ship.fuel)}%`, gx - 12, gy + gh + 20);

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
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 44px Segoe UI';
      ctx.fillText('SPACE RECYCLE HERO', W / 2 - 250, H / 2 - 28);
      ctx.font = '22px Segoe UI';
      ctx.fillStyle = '#9ce8ff';
      ctx.fillText('Press SPACE to launch mission', W / 2 - 145, H / 2 + 12);
    }

    if (game.showHelp) {
      ctx.fillStyle = 'rgba(0,0,0,0.48)';
      ctx.fillRect(14, H - 168, 470, 150);
      ctx.strokeStyle = '#6b7ea8';
      ctx.strokeRect(14, H - 168, 470, 150);
      ctx.fillStyle = '#dce7ff';
      ctx.font = '14px Segoe UI';
      const y0 = H - 142;
      ctx.fillText('A/D rotate | W/S throttle ramp (persistent) | 8/2 seg1 | 7/1 seg2 | 4/6 base | 9 close | 3 open', 24, y0);
      ctx.fillText('Safe landing: skids only, low speed, upright. Hull/cargo impact = crash.', 24, y0 + 26);
      ctx.fillText('Land on REFUEL pads to refill. Land on RECYCLE pads to deliver tray cargo.', 24, y0 + 52);
      ctx.fillText('H: toggle help | Esc: pause', 24, y0 + 78);
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
        updateCamera(dt);
      }
      updateExplosions(dt);
    }

    drawBackground();
    drawTerrainAndPads();
    for (const c of cargos) if (!c.scored) drawCargo(c);
    if (game.state !== 'CRASHED') drawShip();
    drawExplosions();
    drawHUD();

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();
