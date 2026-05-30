param(
  [ValidateSet("template", "verify", "import", "export", "sanitize-env")]
  [string]$Action = "verify",
  [ValidateSet("prod", "dev", "beta")]
  [string]$Environment = "prod",
  [string]$RepoRoot = "",
  [string]$FromEnvFile = "",
  [string]$SecretsDir = "",
  [string]$RuntimeEnvPath = "",
  [switch]$IncludeOptional,
  [switch]$DryRun,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

function Write-Step($message) {
  Write-Host ("[secrets] " + $message)
}

function Resolve-RepoRoot() {
  if (-not [string]::IsNullOrWhiteSpace($RepoRoot)) {
    return (Resolve-Path $RepoRoot).Path
  }
  return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$RepoRoot = Resolve-RepoRoot
Set-Location $RepoRoot

$requiredByEnvironment = @{
  prod = @(
    "SCHOLOGY_PASSWORD",
    "TELEGRAM_BOT_TOKEN",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GITHUB_TOKEN"
  )
  dev = @(
    "SCHOLOGY_PASSWORD",
    "TELEGRAM_BOT_TOKEN",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY"
  )
  beta = @(
    "SCHOLOGY_PASSWORD",
    "TELEGRAM_BOT_TOKEN",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY"
  )
}

$optionalSecretKeys = @(
  "TAILSCALE_AUTH_KEY",
  "SMTP_PASS",
  "EMAIL_PASS",
  "TWILIO_AUTH_TOKEN",
  "CLAUDE_API_KEY"
)

$nonSecretRuntimeKeys = @(
  "SCHOLOGY_USERNAME",
  "SCHOLOGY_LOGIN_URL",
  "SCHOLOGY_GRADES_URL",
  "SCHOLOGY_IDP",
  "SCHOLOGY_SSO_SCHOOL",
  "SCHOLOGY_LOGIN_ATTEMPTS",
  "SCHOLOGY_LOGIN_RETRY_DELAY_MS",
  "STUDENT_NAME",
  "TIMEZONE",
  "SCRAPE_CRON",
  "SEND_CRON",
  "REMINDER_CRON",
  "DELIVERY_CHANNEL",
  "TELEGRAM_CHAT_IDS",
  "TELEGRAM_MESSAGE_THREAD_ID",
  "OPENAI_MODEL",
  "OPENAI_REASONING_EFFORT",
  "OPENAI_MAX_OUTPUT_TOKENS",
  "OPENAI_COMPACT_AFTER_TURNS",
  "OPENAI_COMPACT_AFTER_INPUT_TOKENS",
  "OPENAI_CAPABILITY_GUARD",
  "GITHUB_REPO",
  "GITHUB_LABELS",
  "LOGIN_ALERTS_ENABLED",
  "LOGIN_ALERT_COOLDOWN_MINUTES",
  "LIVE_CHECK_ENABLED",
  "LIVE_CHECK_CRON",
  "LIVE_CHECK_CHAT_IDS",
  "AUTO_IGNORE_ENABLED",
  "AUTO_IGNORE_OLD_DAYS",
  "AUTO_IGNORE_KEYWORDS",
  "AUTO_UPCOMING_ENABLED",
  "AUTO_UPCOMING_DAYS",
  "AUTO_UPCOMING_REMIND_HOUR",
  "AUTO_UPCOMING_REMIND_MINUTE",
  "DASHBOARD_PORT",
  "DEBUG_DUMP",
  "LOGIN_DIAGNOSTIC_PATH",
  "CLAUDE_MANAGED_AGENT_ID",
  "CLAUDE_MANAGED_ENVIRONMENT_ID",
  "CLAUDE_MANAGED_AGENTS_BETA",
  "CLAUDE_MANAGED_MEMORY_STORE_ID",
  "MANAGED_AGENT_MEMORY_STORE_ACCESS",
  "MANAGED_AGENT_MEMORY_STORE_INSTRUCTIONS",
  "MANAGED_AGENT_SESSION_TTL_MINUTES",
  "MANAGED_AGENT_IDLE_TIMEOUT_MINUTES",
  "MANAGED_AGENT_STREAM_TIMEOUT_MS",
  "MANAGED_AGENT_MAX_TOOL_ROUNDS",
  "MANAGED_AGENT_TOOL_RESULT_MAX_CHARS"
)

function Add-CredentialManagerType() {
  if ("SchoologyBot.CredentialManager" -as [type]) {
    return
  }

  Add-Type @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace SchoologyBot {
  public static class CredentialManager {
    private const uint CRED_TYPE_GENERIC = 1;
    private const uint CRED_PERSIST_LOCAL_MACHINE = 2;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL {
      public uint Flags;
      public uint Type;
      public string TargetName;
      public string Comment;
      public long LastWritten;
      public uint CredentialBlobSize;
      public IntPtr CredentialBlob;
      public uint Persist;
      public uint AttributeCount;
      public IntPtr Attributes;
      public string TargetAlias;
      public string UserName;
    }

    [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, uint type, uint reservedFlag, out IntPtr credentialPtr);

    [DllImport("Advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref CREDENTIAL userCredential, uint flags);

    [DllImport("Advapi32.dll", SetLastError = true)]
    private static extern bool CredFree(IntPtr buffer);

    public static void Write(string target, string userName, string secret) {
      byte[] secretBytes = Encoding.Unicode.GetBytes(secret ?? "");
      if (secretBytes.Length > 2560) {
        throw new ArgumentException("Credential is too large for Windows Credential Manager.");
      }
      IntPtr blob = Marshal.AllocHGlobal(secretBytes.Length);
      try {
        Marshal.Copy(secretBytes, 0, blob, secretBytes.Length);
        CREDENTIAL credential = new CREDENTIAL();
        credential.Type = CRED_TYPE_GENERIC;
        credential.TargetName = target;
        credential.CredentialBlobSize = (uint)secretBytes.Length;
        credential.CredentialBlob = blob;
        credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
        credential.UserName = string.IsNullOrWhiteSpace(userName) ? "schoology-bot" : userName;
        if (!CredWrite(ref credential, 0)) {
          throw new Win32Exception(Marshal.GetLastWin32Error());
        }
      } finally {
        for (int i = 0; i < secretBytes.Length; i++) {
          secretBytes[i] = 0;
        }
        Marshal.FreeHGlobal(blob);
      }
    }

    public static string Read(string target) {
      IntPtr credentialPtr;
      if (!CredRead(target, CRED_TYPE_GENERIC, 0, out credentialPtr)) {
        return null;
      }
      try {
        CREDENTIAL credential = (CREDENTIAL)Marshal.PtrToStructure(credentialPtr, typeof(CREDENTIAL));
        if (credential.CredentialBlob == IntPtr.Zero || credential.CredentialBlobSize == 0) {
          return "";
        }
        return Marshal.PtrToStringUni(credential.CredentialBlob, (int)credential.CredentialBlobSize / 2);
      } finally {
        CredFree(credentialPtr);
      }
    }
  }
}
"@
}

function Get-SecretKeys([string]$Name) {
  $keys = @($requiredByEnvironment[$Name])
  if ($IncludeOptional) {
    $keys += $optionalSecretKeys
  }
  return $keys | Select-Object -Unique
}

function Get-CredentialTarget([string]$Name, [string]$Key) {
  return "schoology-bot/$Name/$Key"
}

function ConvertFrom-SecureStringPlain([securestring]$Secure) {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Read-EnvFile([string]$Path) {
  $result = [ordered]@{}
  if (-not (Test-Path $Path)) {
    return $result
  }
  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith("#")) {
      continue
    }
    if ($trimmed -match '^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
      $key = $Matches[1]
      $value = $Matches[2].Trim()
      if (
        ($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))
      ) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      if (-not [string]::IsNullOrWhiteSpace($value)) {
        $result[$key] = $value
      }
    }
  }
  return $result
}

function Get-DefaultSourceFiles([string]$Name) {
  if ($Name -eq "prod") {
    return @(".env", ".env.managed-prod")
  }
  if ($Name -eq "dev") {
    return @(".env.managed-dev", ".env")
  }
  return @(".env.beta", ".env.managed-dev", ".env")
}

function Read-MergedEnv([string[]]$Paths) {
  $merged = [ordered]@{}
  foreach ($path in $Paths) {
    $resolved = Join-Path $RepoRoot $path
    $values = Read-EnvFile $resolved
    foreach ($key in $values.Keys) {
      $merged[$key] = $values[$key]
    }
  }
  return $merged
}

function Quote-EnvValue([string]$Value) {
  if ($null -eq $Value) {
    return '""'
  }
  $escaped = $Value.Replace("\", "\\").Replace('"', '\"')
  return '"' + $escaped + '"'
}

function Write-TextNoBom([string]$Path, [string]$Text) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  if (Test-Path $Path) {
    $item = Get-Item -LiteralPath $Path
    if ($item.IsReadOnly) {
      $item.IsReadOnly = $false
    }
  }
  [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Protect-LocalPath([string]$Path) {
  if (-not (Test-Path $Path)) {
    return
  }
  try {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($account in @($identity, "BUILTIN\Administrators", "NT AUTHORITY\SYSTEM")) {
      $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $account,
        "FullControl",
        "Allow"
      )
      $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
  } catch {
    Write-Step "Warning: could not tighten ACL on $Path"
  }
}

function Import-Secrets() {
  Add-CredentialManagerType
  $keys = Get-SecretKeys $Environment
  $sourceValues = @{}
  if (-not [string]::IsNullOrWhiteSpace($FromEnvFile)) {
    $sourceValues = Read-EnvFile (Join-Path $RepoRoot $FromEnvFile)
  } else {
    $sourceValues = Read-MergedEnv (Get-DefaultSourceFiles $Environment)
  }

  foreach ($key in $keys) {
    $target = Get-CredentialTarget $Environment $key
    if ($DryRun) {
      Write-Step "DRY RUN: would import $target"
      continue
    }

    $secret = $null
    if ($sourceValues.Contains($key)) {
      $secret = [string]$sourceValues[$key]
    } else {
      $secure = Read-Host -AsSecureString "Enter value for $target"
      $secret = ConvertFrom-SecureStringPlain $secure
    }
    if ([string]::IsNullOrWhiteSpace($secret)) {
      if ($requiredByEnvironment[$Environment] -contains $key) {
        throw "Missing required secret: $target"
      }
      continue
    }
    [SchoologyBot.CredentialManager]::Write($target, "schoology-bot", $secret)
    Write-Step "Stored $target"
  }
}

function Verify-Secrets() {
  Add-CredentialManagerType
  $missing = @()
  foreach ($key in (Get-SecretKeys $Environment)) {
    $target = Get-CredentialTarget $Environment $key
    if ($DryRun) {
      Write-Step "DRY RUN: would verify $target"
      continue
    }
    $value = [SchoologyBot.CredentialManager]::Read($target)
    if ([string]::IsNullOrWhiteSpace($value)) {
      if ($requiredByEnvironment[$Environment] -contains $key) {
        $missing += $target
      } else {
        Write-Step "Optional secret not set: $target"
      }
    } else {
      Write-Step "Verified $target"
    }
  }
  if ($missing.Count -gt 0) {
    throw ("Missing required secret(s): " + ($missing -join ", "))
  }
}

function Export-Secrets() {
  Add-CredentialManagerType
  if ([string]::IsNullOrWhiteSpace($SecretsDir)) {
    $SecretsDir = Join-Path $RepoRoot ("data\secrets\" + $Environment)
  }
  if ([string]::IsNullOrWhiteSpace($RuntimeEnvPath)) {
    $RuntimeEnvPath = Join-Path $RepoRoot ("data\runtime\" + $Environment + ".env")
  }

  $keys = Get-SecretKeys $Environment
  if ($DryRun) {
    foreach ($key in $keys) {
      Write-Step ("DRY RUN: would write secret file " + (Join-Path $SecretsDir $key))
    }
    Write-Step "DRY RUN: would write runtime env $RuntimeEnvPath"
    return
  }

  New-Item -ItemType Directory -Force -Path $SecretsDir | Out-Null
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $RuntimeEnvPath) | Out-Null
  Protect-LocalPath $SecretsDir
  Protect-LocalPath (Split-Path -Parent $RuntimeEnvPath)

  $exported = @()
  foreach ($key in $keys) {
    $target = Get-CredentialTarget $Environment $key
    $value = [SchoologyBot.CredentialManager]::Read($target)
    if ([string]::IsNullOrWhiteSpace($value)) {
      if ($requiredByEnvironment[$Environment] -contains $key) {
        throw "Missing required secret: $target"
      }
      continue
    }
    $outPath = Join-Path $SecretsDir $key
    Write-TextNoBom $outPath $value
    Protect-LocalPath $outPath
    $exported += $key
    Write-Step "Exported $target"
  }

  $source = Read-MergedEnv (Get-DefaultSourceFiles $Environment)
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("# Generated by scripts/manage_schoology_secrets.ps1. Do not commit.")
  $lines.Add("RUNTIME_STACK=managed-agents")
  $lines.Add("MANAGED_AGENTS_ENABLED=1")
  $lines.Add("MANAGED_AGENTS_ENV=$Environment")
  $lines.Add("MANAGED_AGENT_SESSION_NAMESPACE=schoology-$Environment")
  foreach ($key in $nonSecretRuntimeKeys) {
    if ($source.Contains($key)) {
      $lines.Add("$key=$(Quote-EnvValue ([string]$source[$key]))")
    }
  }
  foreach ($key in $exported) {
    $lines.Add("${key}_FILE=/run/secrets/$key")
  }
  Write-TextNoBom $RuntimeEnvPath (($lines -join "`n") + "`n")
  Protect-LocalPath $RuntimeEnvPath
  Write-Step "Wrote runtime env $RuntimeEnvPath"
}

function Sanitize-EnvFiles() {
  $secretKeys = @(
    $requiredByEnvironment.prod +
    $requiredByEnvironment.dev +
    $requiredByEnvironment.beta +
    $optionalSecretKeys
  ) | Select-Object -Unique
  $backupRoot = Join-Path $RepoRoot ("data\runtime\env-backups\" + (Get-Date -Format "yyyyMMdd-HHmmss"))
  $files = @(
    ".env",
    ".env.beta",
    ".env.systemd",
    ".env.beta.systemd",
    ".env.managed-dev",
    ".env.managed-prod"
  )
  foreach ($file in $files) {
    $path = Join-Path $RepoRoot $file
    if (-not (Test-Path $path)) {
      continue
    }
    $changed = $false
    $next = New-Object System.Collections.Generic.List[string]
    foreach ($line in Get-Content -LiteralPath $path) {
      if ($line -match '^CHOLOGY_USERNAME\s*=') {
        $next.Add(($line -replace '^CHOLOGY_USERNAME', 'SCHOLOGY_USERNAME'))
        $changed = $true
        continue
      }
      if ($line -match '^OPENCLAW_GATEWAY_TOKEN\s*=') {
        $changed = $true
        continue
      }
      if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)\s*=') {
        $key = $Matches[1]
        if ($secretKeys -contains $key) {
          $next.Add("$key=""""")
          $changed = $true
          continue
        }
      }
      $next.Add($line)
    }
    if ($changed) {
      if ($DryRun) {
        Write-Step "DRY RUN: would sanitize $file"
      } else {
        New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
        Protect-LocalPath $backupRoot
        $backupPath = Join-Path $backupRoot $file
        Copy-Item -LiteralPath $path -Destination $backupPath -Force
        Protect-LocalPath $backupPath
        Write-Step "Backed up $file to $backupPath"
        Write-TextNoBom $path (($next -join "`n") + "`n")
        Write-Step "Sanitized $file"
      }
    }
  }
}

function Show-Template() {
  foreach ($key in (Get-SecretKeys $Environment)) {
    Write-Output (Get-CredentialTarget $Environment $key)
  }
}

switch ($Action) {
  "template" { Show-Template }
  "verify" { Verify-Secrets }
  "import" { Import-Secrets }
  "export" { Export-Secrets }
  "sanitize-env" { Sanitize-EnvFiles }
}
