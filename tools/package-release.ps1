$ErrorActionPreference = 'Stop'
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location -LiteralPath $releaseRoot
try {
    node tools/check-release.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Release checks failed.' }
    $releaseVersion = (Get-Content -Raw -LiteralPath 'package.json' | ConvertFrom-Json).version
    $distRoot = Join-Path $releaseRoot 'dist'
    New-Item -ItemType Directory -Path $distRoot -Force | Out-Null
    $archivePath = Join-Path $distRoot ("boss-job-helper-v{0}.zip" -f $releaseVersion)
    if (Test-Path -LiteralPath $archivePath) { throw 'Archive already exists. Move it elsewhere before rebuilding.' }
    $excludedDirectories = @('node_modules', 'output', 'dist', '.git', '.playwright-cli', '.playwright')
    $releaseFiles = Get-ChildItem -LiteralPath $releaseRoot -Recurse -File -Force | Where-Object {
        $relative = [IO.Path]::GetRelativePath($releaseRoot, $_.FullName)
        $parts = $relative -split '[\\/]'
        -not ($parts | Where-Object { $_ -in $excludedDirectories }) -and
        $_.Name -notlike '.env*' -and $_.Name -notlike '*.local' -and $_.Extension -ne '.log'
    }
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::Open($archivePath, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in $releaseFiles) {
            $entry = 'boss-job-helper/' + [IO.Path]::GetRelativePath($releaseRoot, $file.FullName).Replace('\', '/')
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entry, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally { $archive.Dispose() }
    Write-Output $archivePath
} finally { Pop-Location }
