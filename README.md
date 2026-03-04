# Space Recycle Hero

A full-screen 2D lunar cargo/recycling game for desktop browser (keyboard controls), now with lightweight multiplayer support.

## Multiplayer server (up to 20 players)

1. Run:
   ```bash
   npm start
   ```
2. Open in browser:
   - `http://<server-ip>:8080/`
3. Share that URL with other players on your network.

### Multiplayer behavior
- Supports up to **20 concurrent players**.
- New players are assigned a spawn location that avoids overlap with existing ships.
- If ships touch each other, both are marked as crashed/exploded.
- Your own ship is rendered **white**; other players are rendered **gray**.
- Other players are visible in the world and on the mini-map.
- Radio chat bubbles are visible for all players.
- Session identity is keyed by a persistent browser token (`localStorage`) used as a MAC-like identifier.

## Deploy on Apache2 (Ubuntu)

You can still host the static files with Apache, but multiplayer endpoints require running `server.js`.

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

## Optional PHP usage

This project does **not require PHP** to run.

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
