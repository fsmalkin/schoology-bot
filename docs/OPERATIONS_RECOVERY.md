# Schoology Recovery and DR Runbook

Purpose: restore and operate `schoology-bot` on Windows using a Docker-only unattended runtime with predictable startup and backup/restore behavior.

## Canonical runtime
1. Primary stack: `docker-compose.yml` (`schoology`, `telegram-agent`, `dashboard`).
2. Claude Managed Agents dev/prod bridge is the active replacement target.

## Coexistence contract
Schoology runtime state and Managed Agents dev state must stay isolated.

Schoology reserved ports:
1. `8787` prod dashboard
2. Managed Agents dev bridge currently runs in-process through `telegram-agent`; add separate ports only if a sidecar is introduced.

Chasebot reference ports:
1. `19789`, `19790`
2. `19889`, `19890`

## Prerequisites (host)
Install Docker Desktop and ensure it can start on boot.

Recommended host checks:

```powershell
docker version
docker info
```

## Start stacks (Docker-only)
From `D:\dev\schoology-bot`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start_schoology_stacks.ps1 -RuntimeMode docker
```

Notes:
1. Startup waits for Docker engine readiness before compose actions.
2. If Docker is not ready yet, script retries until timeout and includes diagnostics in error output.

Health checks:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/health
```

## Backup workflow
Daily backup command:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\backup_schoology_state.ps1 -RuntimeMode docker
```

Catalog backup command:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\backup_schoology_catalog_github.ps1
```

Default backup locations:
1. Local snapshots/archives: `D:\backups\schoology\local`
2. Sync target: `D:\backups\schoology\sync`
3. Freshness marker: `D:\backups\schoology\local\backup-status\last-success.json`

Archive includes:
1. `data/state.json`, `data/storage.json`, `data/agent.db`
2. `data/beta/state.json`, `data/beta/storage.json`, `data/beta/agent.runtime.db` until the Managed Agents dev data path is finalized
3. Prod DB SQLite bundle: `db/agent.db.prod`, `db/agent.db.prod-wal`, `db/agent.db.prod-shm`
4. `manifest.json` checksums

## Restore workflow
Restore latest local archive:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\restore_schoology_state.ps1 -RuntimeMode docker -Source local -Snapshot latest
```

Restore synced archive:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\restore_schoology_state.ps1 -RuntimeMode docker -Source sync -Snapshot schoology-backup-YYYYMMDD-HHMMSS.zip
```

Restore behavior:
1. Stops compose stacks.
2. Restores state/data files.
3. Restores prod DB bundle into Docker volume.
4. Restarts stacks and runs health checks.

## Restore drill (required)
Run non-destructive integrity drill:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run_schoology_restore_drill.ps1 -Source local
```

Artifact:
1. `D:\backups\schoology\local\backup-status\restore-drill.json`

Drill failure conditions:
1. Missing required snapshot paths.
2. Missing or partial prod DB bundle (`db/agent.db.prod*`).
3. Manifest missing entries, missing files, or checksum mismatch.

## Task Scheduler registration (non-interactive)
Register Schoology tasks for logged-off execution:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register_schoology_tasks.ps1 -RuntimeMode docker -RunAsUser "$env:USERNAME" -RunAsPassword "<password>"
```

Validation:

```powershell
schtasks /Query /TN Schoology-StartStacks-OnBoot /V /FO LIST
```

Expected:
1. Task logon mode is password-based, not `Interactive only`.
2. Startup fallback artifact is absent in Docker mode:
   `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Schoology-StartStacks-OnLogon.cmd`

## Freshness check
Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check_schoology_backup_freshness.ps1
```

Exit behavior:
1. `0`: fresh
2. `1`: stale
3. `2`: status file missing/invalid

## Decision + Outcome
Decision:
1. Docker-only unattended runtime.
2. Scheduled tasks use password logon mode for non-interactive startup.

Outcome:
1. One operational runtime path.
2. Reliable post-boot/logged-off task execution.
3. Restore drill now fails fast for incomplete SQLite snapshots.

Fallback:
1. If unattended startup fails, run `scripts/start_schoology_stacks.ps1 -RuntimeMode docker` manually.
2. Re-register tasks with a verified `-RunAsPassword` value.
