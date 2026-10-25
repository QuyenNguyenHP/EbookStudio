$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
Write-Host 'EbookStudio: http://127.0.0.1:1997'
Write-Host ('Library: ' + (Join-Path $PSScriptRoot 'Libaries'))
python server.py
