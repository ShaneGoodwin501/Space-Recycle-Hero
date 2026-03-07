# Space Recycle Hero

**Space Recycle Hero** is a browser-based 2D lunar recycling and cargo game. You pilot a utility lander, collect debris with a robotic arm, carry it in your cargo tray, and deliver it to recycle pads while managing fuel, stability, and terrain hazards.

![Space Recycle Hero title image](./Space%20Recycle%20Hero.jpg)

## Table of Contents
- [Features](#features)
- [Requirements](#requirements)
- [Installation & Running](#installation--running)
  - [Option 1: Run locally (quick start)](#option-1-run-locally-quick-start)
  - [Option 2: Deploy with Apache on Ubuntu](#option-2-deploy-with-apache-on-ubuntu)
- [How to Play](#how-to-play)
  - [Mission flow](#mission-flow)
  - [Scoring](#scoring)
  - [Fuel and refueling](#fuel-and-refueling)
  - [Landing and crash rules](#landing-and-crash-rules)
  - [Cargo handling and tray behavior](#cargo-handling-and-tray-behavior)
  - [Track mode and landing gear](#track-mode-and-landing-gear)
  - [Supply ships](#supply-ships)
  - [In-game help and pause](#in-game-help-and-pause)
- [Key Bindings](#key-bindings)
- [HUD / Interface Guide](#hud--interface-guide)
- [Gameplay Tips](#gameplay-tips)
- [Project Structure](#project-structure)
- [Customization / Tuning](#customization--tuning)
- [Troubleshooting](#troubleshooting)

## Features
- Fullscreen canvas-based game (no build tooling required).
- Physics-driven lunar flight with persistent throttle and fuel burn.
- Robotic arm + claw for debris pickup.
- Cargo tray with capacity limit and mass effects on handling.
- Recycle pads for scoring and refuel pads for extending missions.
- Track mode for precise grounded movement.
- In-game help panel, pause support, and radio message UI.
- Periodic supply ships that drop additional debris.

## Requirements
- A modern desktop browser (Chrome, Edge, Firefox, Safari).
- Keyboard input (gameplay is keyboard-first).
- Optional: a local or remote static web server (Apache, Python `http.server`, etc.).

## Installation & Running

### Option 1: Run locally (quick start)
No package manager, dependencies, or build process is needed.

1. Clone the repository:
   ```bash
   git clone https://github.com/ShaneGoodwin501/Space-Recycle-Hero.git
   cd Space-Recycle-Hero
   ```
2. Start a static server from the project root (example with Python):
   ```bash
   python3 -m http.server 8080
   ```
3. Open the game in your browser:
   ```text
   http://localhost:8080
   ```

> You can also open `index.html` directly in some browsers, but serving over HTTP is recommended.

### Option 2: Deploy with Apache on Ubuntu
1. Copy the project into Apache's web root:
   ```bash
   sudo cp -r Space-Recycle-Hero /var/www/html/lunar-cargo
   ```
2. Ensure Apache is installed and running:
   ```bash
   sudo systemctl enable --now apache2
   ```
3. Open:
   ```text
   http://<server-ip>/lunar-cargo/
   ```

## How to Play

### Mission flow
1. Start on the READY screen and press **Space** to begin.
2. Fly to debris fields.
3. Use the arm and claw to pick up cargo.
4. Store cargo in the tray.
5. Land on recycle pads and unload to score.
6. Visit refuel pads when needed.
7. Keep repeating while surviving rough terrain and managing fuel.

### Scoring
- You score by delivering cargo to **RECYCLE HERE** pads.
- Cargo must be properly handled/delivered to count.
- Score is shown in the lower HUD.

### Fuel and refueling
- Throttle consumes fuel continuously.
- Higher throttle burns more fuel.
- Land safely on **refuel pads** to refill.

### Landing and crash rules
- Safe landing depends on:
  - low vertical speed,
  - low overall speed,
  - near-upright angle,
  - proper contact using skids/gear.
- Hard or unstable impact can crash the ship.
- Collisions with terrain/obstacles in bad conditions can trigger explosion/respawn.

### Cargo handling and tray behavior
- The tray has limited capacity.
- Stored cargo adds mass, making handling harder.
- Keep tray operations deliberate during rough motion.
- Offload cargo at recycle pads before overfilling.

### Track mode and landing gear
- **Landing gear** can be extended/retracted in flight mode.
- **Track mode** is for ground precision and can be toggled only while landed/stable.

### Supply ships
- AI supply ships periodically cross the map.
- They drop additional cargo, creating new collection opportunities during longer runs.

### In-game help and pause
- Press **H** to show/hide the mission help panel.
- Press **Esc** to pause/unpause.

## Key Bindings

### Flight
- **A / D**: Rotate ship left / right
- **W / S**: Increase / decrease engine throttle
- **Space**:
  - From READY: start mission
  - During PLAYING: open/close cargo tray

### Robotic Arm & Claw
- **I / K**: Rotate arm base counterclockwise / clockwise
- **U / J**: Arm segment 1 up / down
- **O / L**: Arm segment 2 up / down
- **P / ;**: Close / open claw
- **F**: Fold/unfold arm

### Vehicle Modes
- **E**: Extend/retract landing gear
- **Q**: Toggle track mode (when landed and stable)

### UI / System
- **H**: Toggle help overlay
- **Esc**: Pause/unpause

## HUD / Interface Guide
- **Fuel bar**: Current fuel remaining.
- **Cargo meter**: Current tray load vs capacity.
- **Score panel**: Your current score.
- **Mini-map**: Situational awareness over terrain.
- **Radio input**: Type and send short radio messages visible in-game.

## Gameplay Tips
- Land softly and nearly upright.
- Use gentle throttle corrections instead of aggressive bursts.
- Fold the arm for safer flight segments.
- Use track mode for accurate positioning after landing.
- Deliver frequently; heavy loads reduce maneuverability.
- Refuel proactively before crossing long distances.

## Project Structure
- `index.html` — Canvas and HUD container markup.
- `style.css` — Game and HUD styling.
- `game.js` — Core game logic, physics, rendering, controls, and systems.
- `Space Recycle Hero.jpg` — Project image asset.

## Customization / Tuning
Most gameplay constants are configurable near the top of `game.js`, including:
- gravity, thrust, and damping,
- landing thresholds,
- fuel burn rates,
- arm movement speeds,
- world and content counts,
- supply ship cadence,
- tray capacity.

If you want to tweak difficulty, this is the best place to start.

## Troubleshooting
- **Keyboard input not working as expected:**
  - Click inside the game window first.
  - Check for browser extensions remapping keys.
- **No sound initially:**
  - Interact once (keypress/click) to unlock browser audio context.
- **Game looks stretched or clipped:**
  - Resize the browser window; the canvas resizes dynamically.
- **Direct file open issues (`file://`)**:
  - Run with a local HTTP server instead.
