param(
    [switch]$Local,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$nodeCommand = if ($env:VIBETRACE_NODE) { $env:VIBETRACE_NODE } else { 'node' }
if (-not (Get-Command $nodeCommand -CommandType Application -ErrorAction SilentlyContinue)) {
    Write-Host 'VibeTrace requires Node.js 20+ before this installer can run.'
    Write-Host 'Install Node.js: winget install --exact --id OpenJS.NodeJS.LTS'
    Write-Host 'Or download it from https://nodejs.org/en/download'
    Write-Host 'Open a new terminal after installing, then run this command again.'
    exit 1
}
$installerArgs = @((Join-Path $PSScriptRoot 'vibetrace.mjs'))
if ($CheckOnly) { $installerArgs += 'doctor' } else {
    $installerArgs += 'setup'
    if ($Local) { $installerArgs += '--local' }
}
& $nodeCommand @installerArgs
exit $LASTEXITCODE
