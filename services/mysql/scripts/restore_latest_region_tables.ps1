param(
  [string]$BackupFile = ""
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runner = Join-Path $scriptDir "restore_region_tables.js"

if (-not (Test-Path $runner)) {
  Write-Error "Restore runner not found: $runner"
  exit 1
}

if ([string]::IsNullOrWhiteSpace($BackupFile)) {
  node $runner
} else {
  node $runner $BackupFile
}

if ($LASTEXITCODE -ne 0) {
  Write-Error "Restore failed."
  exit $LASTEXITCODE
}

Write-Host "Restore completed."

