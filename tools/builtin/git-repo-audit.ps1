$ErrorActionPreference = 'Stop'
$Prefix = '::tools-deck::'
$Params = $env:TOOLS_DECK_PARAMS_JSON | ConvertFrom-Json
$Repository = [System.IO.Path]::GetFullPath([string]$Params.repository)
$StaleDays = [Math]::Max([int]$Params.staleDays, 7)

function Emit-Event($Payload) {
  Write-Output ($Prefix + ($Payload | ConvertTo-Json -Compress -Depth 8))
}

if (-not (Test-Path -LiteralPath $Repository -PathType Container)) {
  throw '仓库目录不存在'
}

Emit-Event @{ type = 'progress'; progress = 10; message = '正在读取 Git 仓库状态' }
$Inside = git -C $Repository rev-parse --is-inside-work-tree 2>&1
if ($LASTEXITCODE -ne 0 -or $Inside -ne 'true') {
  throw '目标目录不是 Git 仓库'
}

$Branch = git -C $Repository branch --show-current
$Status = git -C $Repository status --short
Emit-Event @{ type = 'progress'; progress = 45; message = '正在检查本地分支' }
$Cutoff = (Get-Date).AddDays(-1 * $StaleDays)
$Branches = git -C $Repository for-each-ref --format='%(refname:short)|%(committerdate:iso8601)' refs/heads/
$Stale = @()
foreach ($Line in $Branches) {
  $Parts = $Line -split '\|', 2
  if ($Parts.Count -eq 2 -and [DateTime]$Parts[1] -lt $Cutoff) {
    $Stale += $Parts[0]
  }
}

Emit-Event @{ type = 'progress'; progress = 75; message = '正在生成巡检报告' }
$OutputDir = Join-Path ([System.IO.Path]::GetTempPath()) ('tools-deck/' + $env:TOOLS_DECK_RUN_ID)
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$Report = Join-Path $OutputDir 'git-audit-report.md'
$StatusText = if ($Status) { ($Status -join "`n") } else { '工作区干净' }
$StaleText = if ($Stale.Count -gt 0) { ($Stale -join "`n") } else { '无' }
$Lines = @(
  '# Git 仓库巡检报告',
  '',
  "- 仓库：$Repository",
  "- 当前分支：$Branch",
  "- 过期分支阈值：$StaleDays 天",
  '',
  '## 工作区状态',
  '',
  '```text',
  $StatusText,
  '```',
  '',
  '## 过期本地分支',
  '',
  '```text',
  $StaleText,
  '```'
)
$Lines | Set-Content -LiteralPath $Report -Encoding UTF8

Emit-Event @{ type = 'artifact'; progress = 100; artifact = @{ type = 'file'; label = 'Git 巡检报告'; path = $Report; content = $Report } }
Write-Output "巡检完成：$Repository"
