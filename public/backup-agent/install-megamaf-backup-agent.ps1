[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Read-Required([string]$Prompt, [string]$Default = '') {
  $suffix = if ($Default) { " [$Default]" } else { '' }
  $value = Read-Host "$Prompt$suffix"
  if ([string]::IsNullOrWhiteSpace($value)) { $value = $Default }
  if ([string]::IsNullOrWhiteSpace($value)) { throw "$Prompt is required." }
  return $value.Trim()
}
function Read-Secret([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Env-Line([string]$Key, [string]$Value) {
  return "$Key=$($Value | ConvertTo-Json -Compress)"
}

function Require-Command([string]$Name, [string]$Help) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) { throw "$Name is required. $Help" }
  return $command.Source
}

Write-Host ''
Write-Host 'MegaMaf Backup Agent installer' -ForegroundColor Cyan
Write-Host 'Credentials entered here remain on this Windows computer.' -ForegroundColor Yellow
Write-Host ''

$gitPath = Require-Command 'git' 'Install Git for Windows, then run this installer again.'
$nodePath = Require-Command 'node' 'Install the current Node.js LTS version, then run this installer again.'
$null = Require-Command 'npm' 'Install the current Node.js LTS version, then run this installer again.'
$null = Require-Command 'docker' 'Install Docker Desktop, start it, then run this installer again.'

$appUrl = Read-Required 'MegaMaf application URL (https://...)'
$pairingCode = Read-Required 'One-time pairing code from the Backup Devices page'
$deviceName = Read-Required 'Name for this backup computer' $env:COMPUTERNAME
$installDirectory = Read-Required 'Agent installation folder' (Join-Path $env:LOCALAPPDATA 'MegaMafBackupAgent')
$backupDirectory = Read-Required 'Folder where backup archives will be saved' (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'MegaMaf Backups')

if (Test-Path (Join-Path $installDirectory '.git')) {
  Write-Host 'Updating the existing agent files...'
  & $gitPath -C $installDirectory pull --ff-only origin main
} else {
  if (Test-Path $installDirectory) {
    $existing = Get-ChildItem -LiteralPath $installDirectory -Force -ErrorAction SilentlyContinue
    if ($existing) { throw "The installation folder exists and is not empty: $installDirectory" }
  }
  Write-Host 'Downloading the MegaMaf agent files...'
  & $gitPath clone --branch main --single-branch 'https://github.com/ahmedanwarabdulaziz/megamaf.git' $installDirectory
}
if ($LASTEXITCODE -ne 0) { throw 'Could not download the MegaMaf source. Sign in to GitHub if the repository is private, then retry.' }

Push-Location $installDirectory
try {
  Write-Host 'Installing verified dependencies...'
  & npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }

  Write-Host ''
  Write-Host 'Database connection (stored locally only)' -ForegroundColor Cyan
  $dbHost = Read-Required 'Database/pooler host'
  $dbPort = Read-Required 'Database port' '5432'
  $dbName = Read-Required 'Database name' 'postgres'
  $dbUser = Read-Required 'Database user'
  $dbPassword = Read-Secret 'Database password'
  if ([string]::IsNullOrWhiteSpace($dbPassword)) { throw 'Database password is required.' }

  $lines = @(
    (Env-Line 'BACKUP_DB_HOST' $dbHost),
    (Env-Line 'BACKUP_DB_PORT' $dbPort),
    (Env-Line 'BACKUP_DB_NAME' $dbName),
    (Env-Line 'BACKUP_DB_USER' $dbUser),
    (Env-Line 'SUPABASE_DB_PASSWORD' $dbPassword),
    (Env-Line 'BACKUP_DB_SSLMODE' 'require'),
    (Env-Line 'BACKUP_OUTPUT_DIR' $backupDirectory)
  )

  $configureR2 = Read-Host 'Configure R2 attachments on this computer now? (y/N)'
  if ($configureR2 -match '^[Yy]') {
    Write-Host 'R2 connection (stored locally only)' -ForegroundColor Cyan
    $lines += Env-Line 'R2_ENDPOINT' (Read-Required 'R2 endpoint')
    $lines += Env-Line 'R2_ACCESS_KEY_ID' (Read-Required 'R2 access key ID')
    $lines += Env-Line 'R2_SECRET_ACCESS_KEY' (Read-Secret 'R2 secret access key')
    $lines += Env-Line 'R2_BUCKET_NAME' (Read-Required 'Main R2 bucket name')
    $treasuryBucket = Read-Host 'Treasury R2 bucket name (leave empty if unused)'
    if (-not [string]::IsNullOrWhiteSpace($treasuryBucket)) {
      $lines += Env-Line 'R2_BUCKET_NAME_TREASURY' $treasuryBucket.Trim()
    }
  }

  New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllLines((Join-Path $installDirectory '.env.local'), $lines, $utf8NoBom)

  try {
    & icacls.exe $installDirectory /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)F" | Out-Null
  } catch {
    Write-Warning 'Could not tighten folder permissions automatically. Protect this Windows account and folder manually.'
  }

  $env:MEGAMAF_AGENT_APP_URL = $appUrl
  $env:MEGAMAF_AGENT_PAIRING_CODE = $pairingCode
  $env:MEGAMAF_AGENT_DEVICE_NAME = $deviceName
  & $nodePath (Join-Path $installDirectory 'scripts\backup-agent\setup.mjs') --output $backupDirectory
  if ($LASTEXITCODE -ne 0) { throw 'Pairing failed.' }

  $agentScript = Join-Path $installDirectory 'scripts\backup-agent\agent.mjs'
  $agentConfig = Join-Path $installDirectory '.backup-state\agent.json'
  $action = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$agentScript`" --config `"$agentConfig`"" -WorkingDirectory $installDirectory
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1)
  $trigger.Repetition.Interval = 'PT1M'
  $trigger.Repetition.Duration = 'P3650D'
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Hours 12)
  Register-ScheduledTask -TaskName 'MegaMaf Backup Agent' -Action $action -Trigger $trigger -Settings $settings -Description 'Checks MegaMaf for approved backup jobs.' -Force | Out-Null
  Start-ScheduledTask -TaskName 'MegaMaf Backup Agent'

  Write-Host ''
  Write-Host 'Installation completed successfully.' -ForegroundColor Green
  Write-Host "Backups will be saved to: $backupDirectory"
  Write-Host 'Return to the Backup Devices page; this computer should appear online within one minute.'
} finally {
  $env:MEGAMAF_AGENT_PAIRING_CODE = $null
  $env:MEGAMAF_AGENT_APP_URL = $null
  Pop-Location
}
