# learn 启动器（Windows）：找一个能用的 Node 运行 learn.mjs。
$script = Join-Path $PSScriptRoot 'learn.mjs'
if ($env:DSH_DESKTOP_NODE_EXECUTABLE -and (Test-Path $env:DSH_DESKTOP_NODE_EXECUTABLE)) {
  $env:ELECTRON_RUN_AS_NODE = '1'
  & $env:DSH_DESKTOP_NODE_EXECUTABLE $script @args; exit $LASTEXITCODE
}
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) { & $node.Source $script @args; exit $LASTEXITCODE }
Write-Error '找不到可用的 Node。请安装 Node 18+，或确认 DeepSeek Harness 安装完整。'
exit 127
