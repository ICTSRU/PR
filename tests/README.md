# tests — POFlow v1.0
- `gas-mock.js` — in-memory Apps Script services; runs the real `apps-script/Code.gs`.
- `acceptance.test.js` — `node tests/acceptance.test.js` (58 checks: full 3-signer approval, rejection at signer 2, return, delegation, reminders, audit).
- `e2e-server.js` + `e2e.py` — headless Chrome on the real `Index.html` (29 checks). See `docs/TESTING.md`.
