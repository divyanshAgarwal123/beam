# Beam landing page

Run from the repository root:

```sh
python3 -m http.server 18789 --bind 127.0.0.1 --directory website
```

Open http://127.0.0.1:18789/. The page uses static HTML, CSS and JavaScript. To host it, serve this directory as static files. It requires no build, credentials or backend.

The browser simulation contains three fictional requests. The coffee split shows device confirmation, the over-cap scenario introduces World ID, and the external-agent scenario illustrates an MCP handoff. Approval, decline and receipts are browser states. The page does not connect to a wallet, resolve real names, call World or broadcast anything.

The Beam glyph and partner marks come from the Android app. The Inter webfonts come from the previous Orb website and ship with their license files.
