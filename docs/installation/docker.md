# Running Kurbits with Docker

Kurbits ships as a single Docker image containing both the backend and the built web interface.

## Quick start

Pull the image and run it:

```bash
docker pull asegerberg/kurbits-ais

docker run -d --name kurbits -p 8080:8080 \
  -e DATABASE_URL=sqlite:////app/database/kurbits.db \
  -v kurbits_db:/app/database \
  asegerberg/kurbits-ais
```

Then open <http://localhost:8080> in your browser.

What the options do:

- `-d` — runs the container in the background so your terminal is free; drop it if you'd rather watch the logs directly.
- `--name kurbits` — gives the container a fixed name so you can refer to it later (e.g. when running CLI commands below).
- `-p 8080:8080` — makes Kurbits available on port 8080 of your machine.
- `-e DATABASE_URL=sqlite:////app/database/kurbits.db` — stores the database as a SQLite file inside the container.
- `-v kurbits_db:/app/database` — keeps that database in a named Docker volume so your data survives when the container is replaced. **Without this, your data is lost when the container stops.**

Database migrations run automatically on startup.

## Setting up your institution and admin user

Kurbits needs at least one institution and one admin user before anyone can log in. The backend exposes these as Flask CLI commands, which you run inside the running container with `docker exec`.

### Fastest path: one-command demo setup

For trying Kurbits out or setting up a demo, `dev-setup` creates everything in one go — an institution, a system admin, the default hierarchies (ISAD(G), Library, Physical Storage, Classification), and default vocabularies:

```bash
docker exec -it kurbits flask dev-setup
```

This uses sensible defaults (institution "Demo Institution", admin `admin@kurbits.dev` / `admin`) and also creates an archivist and a read-only test user so you can try out role-based access. All of it is configurable:

```bash
docker exec -it kurbits flask dev-setup \
  --institution-name "Gothenburg Municipal Archive" \
  --country-code SE \
  --institution-code GMA \
  --admin-email admin@example.org \
  --admin-password "a-much-stronger-password" \
  --no-extra-users \
  --language sv
```

The command prints a summary of every account it created (or found already existing) at the end, including credentials — keep that output somewhere safe, or better, change the password afterwards.

### Step-by-step path: production setup

For a real deployment you'll usually want more control than `dev-setup` gives you. This is the same result built from the smaller building-block commands:

**1. Create the institution:**

```bash
docker exec -it kurbits flask create-institution
```

This prompts you for `--name`, `--slug`, `--country-code`, and `--institution-code` interactively. You can also pass them directly as flags to skip the prompts:

```bash
docker exec -it kurbits flask create-institution \
  --name "Gothenburg Municipal Archive" \
  --slug gothenburg-municipal-archive \
  --country-code SE \
  --institution-code GMA
```

Note the institution `id` it prints — you'll need it in the next steps.

**2. Create your admin user:**

```bash
docker exec -it kurbits flask create-admin
```

Prompts for `--username`, `--email`, and `--password` (the password is hidden as you type and asked for twice to confirm). This creates a **system admin** — a user with full access across every institution.

**3. Attach the admin to the institution:**

```bash
docker exec -it kurbits flask add-user \
  --email admin@example.org \
  --institution-id 1 \
  --role institution_admin
```

Replace `1` with the institution ID from step 1. This step also sets the institution as the user's active institution, so it's selected automatically on login. `--role` accepts `institution_admin`, `archivist`, or `read_only` — use `institution_admin` for the account you'll administer with day to day.

**4. Seed default hierarchies and vocabularies:**

```bash
docker exec -it kurbits flask seed-hierarchies 1
docker exec -it kurbits flask seed-vocabularies 1 --language en
```

Replace `1` with your institution ID again. `seed-hierarchies` installs the standard hierarchy types (ISAD(G), Library, Physical Storage, Classification); `seed-vocabularies` installs the default controlled vocabularies (`--language` accepts `en` or `sv`). Both skip silently if something's already been seeded — pass `--force` to `seed-vocabularies` to re-seed anyway.

You should now be able to log in at <http://localhost:8080> with the admin email and password you chose.

### Checking what exists

Two read-only commands are useful for verifying setup or troubleshooting later:

```bash
# List every institution, with its ID and reference-code prefix
docker exec -it kurbits flask list-institutions

# List every user, or just the users in one institution
docker exec -it kurbits flask list-users
docker exec -it kurbits flask list-users --institution-id 1
```

### If your container isn't named `kurbits`

All the commands above assume you started the container with `--name kurbits`, as shown in Quick start. If you used a different name, or didn't set one, substitute your own name, or find the container ID with:

```bash
docker ps
```

and use that in place of `kurbits` in the `docker exec` commands.

## Keeping uploaded files

Attached files are stored separately from the database. To keep them too, add a second volume:

```bash
docker run -d --name kurbits -p 8080:8080 \
  -e DATABASE_URL=sqlite:////app/database/kurbits.db \
  -v kurbits_db:/app/database \
  -v kurbits_uploads:/app/uploads \
  asegerberg/kurbits-ais
```

## Building the image yourself

From the project root (the folder containing `backend/` and `frontend/`):

```bash
docker build -t kurbits .
```

Then run it with the same `docker run` command as above, substituting `kurbits` for `asegerberg/kurbits-ais` as the image name.

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
docker pull asegerberg/kurbits-ais
docker stop kurbits && docker rm kurbits
docker run -d --name kurbits -p 8080:8080 \
  -e DATABASE_URL=sqlite:////app/database/kurbits.db \
  -v kurbits_db:/app/database \
  asegerberg/kurbits-ais
```