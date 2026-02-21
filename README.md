# Space Recycle Hero

A full-screen 2D lunar cargo/recycling game for desktop browser (keyboard controls).

## Deploy on Apache2 (Ubuntu)

1. Copy this project folder to your web root, e.g.:
   ```bash
   sudo cp -r Space-Recycle-Hero /var/www/html/lunar-cargo
   ```
2. Ensure Apache is running:
   ```bash
   sudo systemctl enable --now apache2
   ```
3. Open in browser:
   - `http://<server-ip>/lunar-cargo/`

No build step is required. The game is pure static HTML/CSS/JS.

## Optional PHP usage

This project does **not require PHP** to run. Apache + static hosting is enough.

If you want score persistence later, you can add a `save_score.php` endpoint with file locking, but this build keeps scoring local and in-memory.

## Controls

### Flight
- **A / D**: rotate ship left/right
- **W**: ramp throttle up (gradual)
- **S**: ramp throttle down (gradual)
- Throttle stays at last value if neither W nor S is held

### Crane
- **8 / 2**: first arm segment up/down
- **7 / 1**: second arm segment up/down
- **4 / 6**: base swivel CCW/CW
- **9**: close claw
- **3**: open claw

### Other
- **Space**: start mission from landed standby
- **H**: toggle help overlay
- **Esc**: pause/resume

## Gameplay loop

1. Start landed safely.
2. Fly to cargo wreck pieces.
3. Use crane claw to grab cargo.
4. Put cargo into the tray (adds mass, harder handling).
5. Carry to recycle pads marked **RECYCLE HERE**.
6. Land safely on skids and deliver cargo for points.
7. Refuel at refuel stations by landing safely on their pad.

## Critical rules implemented

- Hull touching terrain/obstacles/cargo = crash + explosion.
- Safe landing only on skids with low speed and near-upright angle.
- Moon gravity (~1.62 m/s²), persistent throttle, fuel burn tied to throttle.

## Tuning constants

Top of `game.js` exposes key constants:
- gravity, thrust max, torque
- fuel burn rates
- landing thresholds
- crane angular/claw speeds
- camera dead-zone and smoothing
