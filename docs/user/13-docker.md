# Running Kurbits with Docker

Kurbits ships as a single Docker image containing both the backend and the built web interface.

## Quick start

Pull the image and run it:

```bash
docker pull asegerberg/kurbits-ais

docker run -p 8080:8080 \
  -e DATABASE_URL=sqlite:////app/database/kurbits.db \
  -v kurbits_db:/app/database \
  kurbits
```

Then open <http://localhost:8080> in your browser.

What the options do:

- `-p 8080:8080` — makes Kurbits available on port 8080 of your machine.
- `-e DATABASE_URL=sqlite:////app/database/kurbits.db` — stores the database as a SQLite file inside the container.
- `-v kurbits_db:/app/database` — keeps that database in a named Docker volume so your data survives when the container is replaced. **Without this, your data is lost when the container stops.**

Database migrations run automatically on startup.

## Keeping uploaded files

Attached files are stored separately from the database. To keep them too, add a second volume:

```bash
docker run -p 8080:8080 \
  -e DATABASE_URL=sqlite:////app/database/kurbits.db \
  -v kurbits_db:/app/database \
  -v kurbits_uploads:/app/uploads \
  kurbits
```

## Building the image yourself

From the project root (the folder containing `backend/` and `frontend/`):

```bash
docker build -t kurbits .
```

Then run it with the same `docker run` command as above.

## Common settings

Set these with additional `-e` flags if needed:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Database connection. SQLite (above) or PostgreSQL (`postgresql://user:pass@host:5432/dbname`) |
| `SECRET_KEY` | Secret used to sign sessions — set a long random value in production |
| `PORT` | Port inside the container (default 8080) |

## Updating

Pull the newest image and start a fresh container using the same volumes — your data is preserved:

```bash
docker pull kurbits
docker run -p 8080:8080 \
  -e DATABASE_URL=sqlite:////app/database/kurbits.db \
  -v kurbits_db:/app/database \
  kurbits
```
