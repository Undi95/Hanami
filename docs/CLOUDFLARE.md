**English** | [Français](CLOUDFLARE.fr.md)

# Remote access with Cloudflare Tunnel

Goal: reach Hanami from outside your home (mobile data, on the go, office) **without opening a
port** on your router, with automatic HTTPS.

Related: [MOBILE.md](MOBILE.md) · [back to the README](../README.md)

## 1. Requirements

- A (free) Cloudflare account with your domain added — or a throwaway `*.trycloudflare.com`
  subdomain, which needs no account at all.
- `cloudflared` installed: <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>

## 2. Quick test (throwaway URL, no account)

Start Hanami first **in production mode** (`npm run build` then `npm start`), then:

⚠️ **Never point the tunnel at `npm run dev`**: dev mode exposes Vite tooling (such as the
`/@fs/` endpoint) that can serve local files — only a production instance should be tunneled.

```bash
cloudflared tunnel --url http://localhost:7788
```

Cloudflare prints a `https://xxxx.trycloudflare.com` URL — open it on your phone.
⚠️ That URL changes on every run: handy for a quick test, not for daily use.

## 3. Permanent tunnel (recommended)

```bash
cloudflared tunnel login
cloudflared tunnel create hanami
cloudflared tunnel route dns hanami hanami.your-domain.tld
```

Create `%UserProfile%\.cloudflared\config.yml`:

```yaml
tunnel: hanami
credentials-file: C:\Users\<you>\.cloudflared\<uuid>.json
ingress:
  - hostname: hanami.your-domain.tld
    service: http://localhost:7788
  - service: http_status:404
```

Then:

```bash
cloudflared tunnel run hanami
```

To start it automatically with Windows:

```bash
cloudflared service install
```

## 4. Security — do this before exposing anything

1. **Set the Hanami password**: ⚙️ *Settings* → "Access password". Without it, anyone holding
   the URL can read your conversations.
2. **Better still: Cloudflare Access** (free up to 50 users). In the Zero Trust dashboard →
   Access → Applications, add `hanami.your-domain.tld` with a policy such as
   "Allowed emails: you@example.com". Cloudflare then requires an emailed code before the
   request even reaches Hanami. Both protections stack — use both.
3. Only share the URL with people you trust: the LLM backend and the file tools run on **your**
   machine.

## 5. Note

Your PC (and your local LLM backend) must stay awake for Hanami to answer remotely. Consider
disabling sleep (Windows Settings → Power).
