# Secrets And Managed Prod Cutover

Windows Credential Manager is the source of truth for live secrets. Ignored
`.env*` files may keep non-secret runtime configuration, but live token/password
values should be blank after migration.

Credential rotation is not required for this cutover unless a specific secret is
known to have leaked outside trusted local/operator context. The default cutover
path imports the current live values into Windows Credential Manager, exports
Docker secret files, then sanitizes local env files.

## Credential Names
Required prod secrets:

- `schoology-bot/prod/SCHOLOGY_PASSWORD`
- `schoology-bot/prod/TELEGRAM_BOT_TOKEN`
- `schoology-bot/prod/OPENAI_API_KEY`
- `schoology-bot/prod/ANTHROPIC_API_KEY`
- `schoology-bot/prod/GITHUB_TOKEN`

Optional secrets, when used:

- `schoology-bot/prod/TAILSCALE_AUTH_KEY`
- `schoology-bot/prod/SMTP_PASS`
- `schoology-bot/prod/EMAIL_PASS`
- `schoology-bot/prod/TWILIO_AUTH_TOKEN`
- `schoology-bot/prod/CLAUDE_API_KEY`

## Workflow
1. Import current live values into Windows Credential Manager:
   `powershell -ExecutionPolicy Bypass -File scripts/manage_schoology_secrets.ps1 -Action import -Environment prod`
2. Verify without printing values:
   `powershell -ExecutionPolicy Bypass -File scripts/manage_schoology_secrets.ps1 -Action verify -Environment prod`
3. Export Docker secret files and generated runtime env:
   `powershell -ExecutionPolicy Bypass -File scripts/manage_schoology_secrets.ps1 -Action export -Environment prod`
4. Sanitize ignored local env files:
   `powershell -ExecutionPolicy Bypass -File scripts/manage_schoology_secrets.ps1 -Action sanitize-env -Environment prod`
5. Run the tracked secret scan:
   `npm run secrets:scan`

The export writes ignored files under `data/secrets/prod/` and
`data/runtime/prod.env`. These are local deployment artifacts, not repo state.
The sanitize step writes ignored rollback copies under
`data/runtime/env-backups/<timestamp>/` before blanking local env-file secret
values.

## Managed Prod Start And Rollback
Start Managed Agents prod:

```powershell
docker compose -f docker-compose.yml -f docker-compose.managed-prod.yml -p schoology-prod up -d --build
```

Rollback to the committed Docker prod runtime:

```powershell
docker compose -f docker-compose.yml -p schoology-prod up -d --build
```

The rollback path removes the managed-prod override and keeps the same Docker
volume-backed prod DB. Restore a pre-cutover backup only if runtime validation
shows data corruption or unintended writes.
