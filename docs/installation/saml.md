# SAML Single Sign-On

When `SAML_ENABLED=1`, Kurbits authenticates users through a SAML 2.0 IdP. Local login and user creation are disabled. Users are created on first SSO login and must then be added to an institution:

```bash
flask add-user --email user@example.org --institution-id 1 --role archivist
```

## Configuration

| Variable | Description |
|---|---|
| `SAML_ENABLED` | `1` to enable. Defaults to `0`. |
| `SAML_USERNAME_ATTR` | IdP attribute holding the username. |
| `SAML_EMAIL_ATTR` | IdP attribute holding the email. |
| `SAML_ENTITY_ID` | Entity ID registered at the IdP. |
| `SAML_METADATA_URI` | URL to the IdP metadata. |
| `SAML_CERT_PATH` | Path to the SP certificate. |
| `SAML_KEY_PATH` | Path to the SP private key. |

Register at the IdP:

- ACS URL: `https://<host>/api/v1/saml2/authenticate`
- SP metadata: `https://<host>/api/v1/saml2/metadata`

SAML requires HTTPS, terminated by a reverse proxy.

## Local testing with Docker

Put `sp.crt`, `sp.key` and `saml.env` next to the `Dockerfile`, and add all three to `.gitignore` and `.dockerignore`.

`saml.env`:

```bash
SAML_ENABLED=1
SAML_USERNAME_ATTR=<username-attribute>
SAML_EMAIL_ATTR=<email-attribute>
SAML_ENTITY_ID=<entity-id>
SAML_METADATA_URI=<idp-metadata-url>
SAML_CERT_PATH=/etc/kurbits/saml/sp.crt
SAML_KEY_PATH=/etc/kurbits/saml/sp.key
```

Run Kurbits and Caddy for TLS:

```bash
docker build -t kurbits .

docker run -d --name kurbits -p 8080:8080 \
  -e DATABASE_URL=postgresql://kurbits:kurbits@host.docker.internal:5432/kurbits \
  --env-file saml.env \
  -v "$(pwd)/sp.crt:/etc/kurbits/saml/sp.crt:ro" \
  -v "$(pwd)/sp.key:/etc/kurbits/saml/sp.key:ro" \
  kurbits

docker run -d --name kurbits-tls -p 8443:8443 \
  caddy caddy reverse-proxy --from localhost:8443 --to host.docker.internal:8080
```

Open `https://localhost:8443`. The IdP must have `https://localhost:8443/api/v1/saml2/authenticate` registered as ACS URL.