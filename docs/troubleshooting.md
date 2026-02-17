# Troubleshooting

## Docker / Postgres

### Check if Postgres container is running

```bash
docker compose ps
```

### Check if Postgres is accepting connections inside the container

```bash
docker exec rocket-backend-postgres-1 pg_isready -U rocket -d rocket
```

### Check if Postgres is reachable from the host

```bash
PGPASSWORD=rocket psql -h localhost -p 5433 -U rocket -d rocket -c "SELECT 1"
```

### Check what's listening on port 5433

```bash
ss -tlnp sport = :5433
```

### Check container port mappings

```bash
docker port rocket-backend-postgres-1
```

### View Postgres container logs

```bash
docker logs rocket-backend-postgres-1 --tail 50
```

### Test query from inside the container

If host connections fail but you suspect Postgres itself is fine:

```bash
docker exec rocket-backend-postgres-1 psql -U rocket -d rocket -c "SELECT 1"
```

### Stale Docker proxy (port open but connections hang)

**Symptom:** Port 5433 is listening (`ss` shows it), TCP connects, but `psql` hangs or returns "server closed the connection unexpectedly".

**Cause:** Docker's port-forwarding proxy can get into a bad state after a container restart.

**Fix:** A full `docker compose down && up` (not just `restart`) recreates the network and proxy:

```bash
docker compose down && docker compose up -d
```

Wait a few seconds, then verify:

```bash
PGPASSWORD=rocket psql -h localhost -p 5433 -U rocket -d rocket -c "SELECT 1"
```

### Reset Postgres data completely

> **Warning:** This deletes all data.

```bash
docker compose down -v && docker compose up -d
```

The `-v` flag removes the `pgdata` volume, giving you a fresh database.
