# learn 启动器（Windows）：找一个能用的 Node 运行 learn.mjs。
$script = Join-Path $PSScriptRoot 'learn.mjs'
# 有管道输入（--json - / --question -）就原样转给 Node；Windows PowerShell 5.1 默认按 ASCII 往外送，中文会变问号，先改成 UTF-8
$in = @($input)
if ($in.Count) { $OutputEncoding = [System.Text.UTF8Encoding]::new($false) }
if ($env:DSH_DESKTOP_NODE_EXECUTABLE -and (Test-Path $env:DSH_DESKTOP_NODE_EXECUTABLE)) {
  $env:ELECTRON_RUN_AS_NODE = '1'
  if ($in.Count) { $in | & $env:DSH_DESKTOP_NODE_EXECUTABLE $script @args } else { & $env:DSH_DESKTOP_NODE_EXECUTABLE $script @args }
  exit $LASTEXITCODE
}
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  if ($in.Count) { $in | & $node.Source $script @args } else { & $node.Source $script @args }
  exit $LASTEXITCODE
}
Write-Error '找不到可用的 Node。请安装 Node 18+，或确认 DeepSeek Harness 安装完整。'
exit 127
