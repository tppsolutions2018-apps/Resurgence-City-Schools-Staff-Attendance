# Firebase App Hosting deployment

This repository is configured for Firebase App Hosting. The existing Render deployment files and PostgreSQL architecture are intentionally preserved.

## What Firebase will run

Firebase App Hosting will start the existing Express server with:

`node server/server.js`

The frontend remains in `public/`, and Express serves it directly.

## Before the first deployment

1. Create a Firebase project.
2. Upgrade the Firebase project to the **Blaze** plan. Firebase App Hosting requires Blaze.
3. Create or choose a PostgreSQL database that is reachable from the public internet. This application currently uses PostgreSQL; Firebase App Hosting does not replace that database automatically.
4. In Firebase App Hosting, connect this GitHub repository:
   - Repository: `tppsolutions2018-apps/Resurgence-City-Schools-Staff-Attendance`
   - Branch: `main`
5. Create these App Hosting secrets:
   - `DATABASE_URL` — the PostgreSQL connection string.
   - `JWT_SECRET` — a random value of at least 32 characters.
   - `ADMIN_PASS` — the initial administrator password, at least 8 characters.
6. Leave `ADMIN_USER` as `admin`, or set another administrator username.
7. Start the first rollout.

## Important

Do **not** put the database password, JWT secret, or administrator password in GitHub. The checked-in `apphosting.yaml` references Firebase/Google Secret Manager instead.

## After deployment

Test:

- `/api/health`
- Admin login
- Teacher login and multi-class access
- Teacher student registration
- Student login and assignment features
- Parent portal
- Attendance clock-in/out and location
- Admin reports/export

Firebase App Hosting automatically creates new rollouts when changes are pushed to the connected live branch.

## Local Firebase CLI option

If you prefer to manage deployment from a terminal, install the Firebase CLI and use App Hosting commands from the repository root. Do not create a fake `.firebaserc` file until the real Firebase project ID is known.
