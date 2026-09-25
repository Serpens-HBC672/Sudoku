param([string]$Name = 'Sudoku-WASM-delivery')
$ErrorActionPreference = 'Stop'
$migration = $PSScriptRoot
$checkout = Split-Path $migration -Parent
$parent = Split-Path $checkout -Parent
if ($Name -notmatch '^[A-Za-z0-9_-]+$') { throw 'Name must be a simple directory name' }
$destination = Join-Path $parent $Name
$zip = "$destination.zip"
$extracted = "$destination-extracted"
foreach ($path in @($destination,$zip,$extracted)) {
  if (Test-Path -LiteralPath $path) { throw "Refusing to overwrite $path" }
}
$sourceCommit = (git -C $checkout rev-parse HEAD).Trim()
New-Item -ItemType Directory -Path "$destination/wasm-migration" | Out-Null
foreach ($directory in @('assembly','bridge','tests','benchmark','build','evidence')) {
  Copy-Item -LiteralPath (Join-Path $migration $directory) -Destination "$destination/wasm-migration" -Recurse
}
foreach ($file in Get-ChildItem -LiteralPath $migration -File) {
  if ($file.Extension -eq '.md' -or $file.Name -in @('package.json','package-lock.json','package-delivery.ps1')) {
    Copy-Item -LiteralPath $file.FullName -Destination "$destination/wasm-migration"
  }
}
foreach ($file in @('Sudoku v3.23.3-rc.3 - DevVer.html','求解器的数独基准测试盘面参考.txt')) {
  Copy-Item -LiteralPath (Join-Path $checkout $file) -Destination $destination
}
@'
# Sudoku WASM delivery

Start with [README_FIRST](wasm-migration/README_FIRST.md) and the actual [delivery report](wasm-migration/DELIVERY_REPORT.md).
The compiled module is wasm-migration/build/sudoku-techniques.wasm. Keep this directory structure for rebuilding and running the frozen oracle/corpus tools.
manifest.json records the source commit, compiler/runtime, binary and all packaged file hashes. node_modules, .git, credentials and Android products are excluded.
'@ | Set-Content -LiteralPath "$destination/README_FIRST.md" -Encoding utf8
$files = @(Get-ChildItem -LiteralPath $destination -Recurse -File | Sort-Object FullName | ForEach-Object {
  @{ path = [IO.Path]::GetRelativePath($destination,$_.FullName).Replace('\','/'); bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower() }
})
$wasm = Get-Item -LiteralPath "$destination/wasm-migration/build/sudoku-techniques.wasm"
$manifest = @{
  sourceCommit = $sourceCommit; baseline = 'caaef8df1b939142ac79445f33696e16bb092f78';
  node = (& node --version); assemblyscript = '0.27.31'; runtime = 'incremental';
  flags = '--runtime incremental --optimizeLevel 3 --shrinkLevel 0 --exportRuntime';
  wasmSha256 = (Get-FileHash -LiteralPath $wasm.FullName).Hash.ToLower(); wasmBytes = $wasm.Length;
  acceptance = 'wasm-migration/DELIVERY_REPORT.md'; files = $files
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$destination/manifest.json" -Encoding utf8
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($destination,$zip)
[IO.Compression.ZipFile]::ExtractToDirectory($zip,$extracted)
foreach ($entry in $files) {
  $hash = (Get-FileHash -LiteralPath (Join-Path $extracted $entry.path)).Hash.ToLower()
  if ($hash -ne $entry.sha256) { throw "Extraction hash mismatch: $($entry.path)" }
}
Push-Location "$extracted/wasm-migration"
try { & node tests/delivery-smoke.mjs; if ($LASTEXITCODE) { throw 'Extracted smoke failed' } } finally { Pop-Location }
$summary = @{sourceCommit=$sourceCommit;directory=$destination;zip=$zip;zipSha256=(Get-FileHash -LiteralPath $zip).Hash.ToLower();wasmSha256=$manifest.wasmSha256;extracted=$extracted;filesVerified=$files.Count;smoke='PASS'}
$summary | ConvertTo-Json | Set-Content -LiteralPath "$zip.receipt.json" -Encoding utf8
$summary | ConvertTo-Json
