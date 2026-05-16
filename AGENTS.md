# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

This is a vanilla HTML/CSS/JS Progressive Web App (PWA) — a weather widget branded for "La Nordica - Extraflame". There is **no build system, no package manager, no dependencies, and no backend**. The entire app is 6 static files.

### Running the app

Serve the repository root with any static HTTP server:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080/` in a browser. The app fetches weather data from the public [Open-Meteo API](https://open-meteo.com/) (no API key needed).

### Lint / Tests / Build

- **Lint**: No linter is configured. You can optionally run `npx eslint app.js sw.js` if ESLint is globally available.
- **Tests**: No automated test suite exists.
- **Build**: There is no build step — files are served as-is.

### Key notes for development

- The app uses the **Open-Meteo** geocoding and forecast APIs (`geocoding-api.open-meteo.com`, `api.open-meteo.com`). No authentication or API key is required.
- Service Worker (`sw.js`) caches assets and API responses for offline use. It requires a **secure context** (HTTPS or localhost) to register.
- State is persisted in `localStorage` under keys `meteo-nordica-v1` (weather cache), `meteo-nordica-indoor` (indoor temperature), and `meteo-nordica-house` (m², classe energetica, combustibile for fuel estimate).
- The UI language is Italian.
