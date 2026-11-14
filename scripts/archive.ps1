param(
    [Parameter(Mandatory = $true)][ValidateSet('create', 'extract')][string]$Action,
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sourceAbsolute = [IO.Path]::GetFullPath($Source)
$destinationAbsolute = [IO.Path]::GetFullPath($Destination)
if ($Action -eq 'create') {
    if ([IO.File]::Exists($destinationAbsolute)) { throw 'Archive already exists.' }
    [IO.Compression.ZipFile]::CreateFromDirectory($sourceAbsolute, $destinationAbsolute, [IO.Compression.CompressionLevel]::Optimal, $true)
} else {
    if ([IO.Directory]::Exists($destinationAbsolute)) { throw 'Extraction destination already exists.' }
    $zip = [IO.Compression.ZipFile]::OpenRead($sourceAbsolute)
    try {
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName.Replace('\', '/')
            if (-not $name.StartsWith('ath-project-knowledge/') -or $name.Contains(':') -or $name.Split('/') -contains '..' -or $name.Split('/') -contains '.') { throw 'Unsafe archive entry.' }
        }
    } finally { $zip.Dispose() }
    [IO.Compression.ZipFile]::ExtractToDirectory($sourceAbsolute, $destinationAbsolute)
}
