# Resurgence City Schools Staff Attendance & Report — Current Working Project

This package contains the current working RCS Staff + Admin system based on the tested working attendance system.

## Included
- `public/index.html` — Admin portal, including Staff management, attendance, reports and activity reports.
- `public/staff-login.html` — Staff login portal with Clock In/Out and Daily Activities Report.
- `public/logo.png` — Resurgence City Schools branding logo.
- `public/manifest.json` — PWA manifest.
- `public/sw.js` — Service worker.
- `server/server.js` — Render/Express backend with cloud persistence and Staff/Admin authentication.
- `package.json` — Node dependencies/start script.
- `render.yaml` — Render deployment configuration.

## Important
Keep the project structure unchanged when uploading/deploying. Do not place the frontend files inside the server folder.

Set the required Render environment variables used by `server/server.js` (including `JWT_SECRET`, `ADMIN_USER`, `ADMIN_PASS`, and `DATABASE_URL`). Do not store real passwords in this README or in the source files.
