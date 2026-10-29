# 내 PC에서 대시보드를 미리 보는 간단한 웹 서버
# 실행: powershell -ExecutionPolicy Bypass -File scripts/serve.ps1   ->  http://localhost:8080
param([int]$Port = 8080, [string]$Root = (Split-Path -Parent $PSScriptRoot))

$types = @{
    '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'; '.png' = 'image/png'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'
}
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "http://localhost:$Port/ 에서 보는 중 (Ctrl+C로 종료)"
try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
        if (-not $rel) { $rel = 'index.html' }
        $path = [IO.Path]::GetFullPath((Join-Path $Root $rel))
        $res = $ctx.Response
        if ($path.StartsWith([IO.Path]::GetFullPath($Root)) -and (Test-Path $path -PathType Leaf)) {
            $bytes = [IO.File]::ReadAllBytes($path)
            $ext = [IO.Path]::GetExtension($path).ToLower()
            $res.ContentType = if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' }
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $res.StatusCode = 404
        }
        $res.Close()
    }
} finally {
    $listener.Stop()
}
