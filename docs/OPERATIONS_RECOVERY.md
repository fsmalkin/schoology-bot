# Schoology Recovery and DR Runbook

Purpose: restore `schoology-bot` runtime on a rebuilt Windows machine with a native WSL/systemd runtime, and keep backups current with coexistence-safe naming.

## Canonical naming
1. Legacy beta: `docker-compose.beta.yml` (`schoology-beta` + `telegram-agent-beta`) - deprecated for routine operations.
2. Schoology OpenClaw beta: native equivalent of `docker-compose.beta-openclaw.yml` (`gateway`, `tool-api`, `monitor`, `cron-sync`, optional dashboard).
3. Chasebot OpenClaw: separate stack in `D:\dev\openclaw` only.

## Coexistence contract
Schoology and Chasebot OpenClaw run on the same machine, but must remain isolated.

Schoology ports:
1. `8787` prod dashboard
2. `8788` beta dashboard
3. `18799` beta gateway
4. `18800` beta reserved bridge/derived port (reserved to avoid collisions; listener may be absent on current OpenClaw builds)

Chasebot reference ports:
1. `19789`, `19790`
2. `19889`, `19890`

Never run Schoology operations that target `docker-compose.beta.yml` unless explicitly approved for rollback.

## One-time pre-cutover snapshot
Before native cutover, capture an immutable snapshot:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\create_schoology_pre_cutover_snapshot.ps1
```

Snapshot contents:
1. `data\`
2. `openclaw_workspace\`
3. `.env`, `.env.beta`
4. `scripts\`
5. exported scheduled task XML definitions (`Schoology-*` by default)
6. SHA-256 manifest + summary metadata

## Prerequisites (host + WSL)
PowerShell (elevated where required):

```powershell
wsl --install --no-distribution
winget install -e --id OpenJS.NodeJS.LTS
winget install -e --id Docker.DockerDesktop
winget install -e --id Google.GoogleDrive
```

`%USERPROFILE%\.wslconfig` baseline:

```ini
[wsl2]
memory=8GB
processors=6
swap=2GB
localhostForwarding=true
vmIdleTimeout=3600000

[experimental]
autoMemoryReclaim=gradual
```

WSL distro must have systemd enabled (`/etc/wsl.conf`):

```ini
[boot]
systemd=true
```

## Native runtime installation
From `D:\dev\schoology-bot`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install_schoology_native_services.ps1 -EnableNow
```

This installs:
1. `schoology.target`
2. Prod services (`schoology-prod-scheduler`, `schoology-prod-telegram`, `schoology-prod-dashboard`)
3. Beta services (`schoology-beta-tool-api`, `schoology-beta-gateway`, `schoology-beta-monitor`, `schoology-beta-dashboard`)
4. `schoology-beta-cron-sync.service` + `schoology-beta-cron-sync.timer` (`OnBootSec=90s`, `OnUnitActiveSec=6h`)
5. sanitized systemd env files (`.env.systemd`, `.env.beta.systemd`) to avoid BOM/encoding parsing issues

## Start stacks (preferred)
Use helper script (native default):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start_schoology_stacks.ps1
```

Useful overrides:

```powershell
# explicit native mode
powershell -ExecutionPolicy Bypass -File .\scripts\start_schoology_stacks.ps1 -RuntimeMode native

# docker fallback mode
powershell -ExecutionPolicy Bypass -File .\scripts\start_schoology_stacks.ps1 -RuntimeMode docker
```

Health checks:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/health
Invoke-RestMethod http://127.0.0.1:8788/api/health
```

Native status checks:

```powershell
wsl -d Ubuntu-24.04 -- bash -lc "systemctl status schoology.target --no-pager"
wsl -d Ubuntu-24.04 -- bash -lc "systemctl list-timers schoology-beta-cron-sync.timer --no-pager"
```

## Backup workflow
Daily backup script (native default):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\backup_schoology_state.ps1
```

Catalog backup script (GitHub metadata only, no secrets/state payload):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\backup_schoology_catalog_github.ps1
```

Default backup locations:
1. Local snapshots and archives: `D:\backups\schoology\local`
2. Off-machine sync target: `D:\backups\schoology\sync` (Google Drive)
3. Freshness status marker: `D:\backups\schoology\local\backup-status\last-success.json`

Backed up data:
1. `data/state.json`
2. `data/storage.json`
3. `data/agent.db`
4. `data/beta/state.json`
5. `data/beta/storage.json`
6. `data/beta/agent.db`
7. `data/openclaw-beta/`
8. `openclaw_workspace/`
9. `db/agent.db.prod` snapshot
10. checksum manifest

## Restore workflow
Restore latest local archive:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\restore_schoology_state.ps1 -RuntimeMode native -Source local -Snapshot latest
```

Restore synced archive:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\restore_schoology_state.ps1 -RuntimeMode native -Source sync -Snapshot schoology-backup-YYYYMMDD-HHMMSS.zip
```

Restore behavior:
1. Stops Schoology runtime
2. Restores state/data/openclaw directories
3. Restores prod DB snapshot
4. Restarts runtime and checks dashboards

Monthly restore-drill integrity check (non-destructive):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run_schoology_restore_drill.ps1 -Source local
```

Drill artifact:
1. `D:\backups\schoology\local\backup-status\restore-drill.json`

## Task scheduler registration
Register tasks:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register_schoology_tasks.ps1 -RuntimeMode native
```

Task names:
1. `Schoology-Backup-Daily`
2. `Schoology-Backup-FreshnessHourly`
3. `Schoology-Backup-Catalog-Daily`
4. `Schoology-RestoreDrill-Monthly`
5. `Schoology-StartStacks-OnBoot`
6. `Schoology-StartStacks-OnLogon`

Freshness check:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check_schoology_backup_freshness.ps1
```

Exit behavior:
1. `0`: fresh
2. `1`: stale
3. `2`: status file missing/invalid

## Smoke checklist
1. Prod dashboard health endpoint responds.
2. Beta dashboard health endpoint responds.
3. Beta gateway listens on `18799`; `18800` remains reserved for Schoology port ownership.
4. Prod and beta Telegram bots respond in intended chats.
5. Backup archive appears in local and sync roots.
6. Freshness check returns `0` after backup.
7. Restore drill artifact reports `ok=true`.
