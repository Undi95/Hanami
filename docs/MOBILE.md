**English** | [Français](MOBILE.fr.md)

# Hanami on a phone

Related: [CLOUDFLARE.md](CLOUDFLARE.md) · [back to the README](../README.md)

## Reaching it

- **Same Wi-Fi as the PC**: open `http://<pc-ip>:7788`. The LAN address is printed in the
  console when Hanami starts.
- **From anywhere else** (4G/5G, on the move…): through a Cloudflare Tunnel →
  [CLOUDFLARE.md](CLOUDFLARE.md).

## Installing it as an app (PWA)

### Android (Chrome)

1. Open the Hanami URL.
2. Menu ⋮ → **"Add to Home screen"** (or "Install app").
3. Hanami opens full-screen, without the address bar.

### iPhone / iPad (Safari)

1. Open the Hanami URL.
2. Share button □↑ → **"Add to Home Screen"**.

## Tips

- The mobile layout shows the avatar full-screen with the chat in a bottom sheet — drag the
  handle down to see more of your character.
- 3D rendering pauses when the app goes to the background, to save battery.
- On a slow connection (public Wi-Fi…), the chat still works while the 3D model is loading:
  text never waits for the avatar.
- If you expose Hanami outside your home network, set an access password first — see the
  security section of [CLOUDFLARE.md](CLOUDFLARE.md).
