$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

Write-Host 'Installing/updating the Windows packaging tool...'
python -m pip install -r requirements-build.txt

Write-Host 'Building EbookStudio.exe...'
python -m PyInstaller --noconfirm --clean EbookStudio.spec

$output = Join-Path $PSScriptRoot 'dist\EbookStudioDesktop.exe'
if (-not (Test-Path -LiteralPath $output)) {
    throw "Build completed without the expected output: $output"
}

Write-Host ''
Write-Host "Created: $output"
Write-Host 'Copy this EXE to a Windows laptop and double-click it.'
Write-Host 'User PDFs and notes are stored in %LOCALAPPDATA%\EbookStudio\Libaries.'
