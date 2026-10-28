param()

$ErrorActionPreference = 'Stop'
$rrRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$rrFailures = New-Object 'System.Collections.Generic.List[string]'
$rrPhaseIds = @(
    '01-project-foundation',
    '02-supabase-database',
    '03-core-opportunity-pipeline',
    '04-conference-sources',
    '05-research-job-sources',
    '06-journal-cfp-sources',
    '07-telegram-bot',
    '08-ranking-and-personalization',
    '09-automation-and-reliability',
    '10-production-hardening-and-verification'
)
$rrRequired = @(
    'README.md', 'PRODUCT_SPEC.md', 'ARCHITECTURE.md', 'AGENTS.md',
    'PLANS.md', 'DATA_SOURCES.md', 'DATABASE.md', 'DEPLOYMENT.md',
    'OPERATIONS.md', 'CHANGELOG.md', 'docs/TESTING.md', '.gitignore',
    'docs/adr/0000-template.md',
    'docs/adr/0001-supabase-backend.md',
    'docs/adr/0002-edge-functions-runtime.md',
    'docs/adr/0003-telegram-webhook.md',
    'docs/adr/0004-shared-opportunity-domain.md',
    'docs/adr/0005-deterministic-first-ranking.md',
    'docs/adr/0006-durable-bounded-work.md'
)
$rrRequired += $rrPhaseIds | ForEach-Object { "harness/build/$_.md" }
$rrSections = @(
    'Goal', 'Context', 'Dependencies', 'Non-goals', 'Implementation scope',
    'Expected files/modules', 'Acceptance criteria', 'Validation commands',
    'Manual verification', 'Known risks', 'Exit criteria'
)
$rrDocumentSections = @{
    'PRODUCT_SPEC.md' = @(
        'Problem', 'Primary user', 'Goals', 'Non-goals', 'Opportunity types',
        'Core user journeys', 'Functional requirements', 'Notification behavior',
        'Ranking behavior', 'Non-functional requirements', 'Reliability requirements',
        'Security requirements', 'Success criteria', 'Definition of Done for the final product'
    )
    'ARCHITECTURE.md' = @(
        'System context and decisions', 'High-level architecture', 'Data flow and pipeline',
        'Module boundaries and dependency direction', 'Source adapter architecture',
        'Opportunity domain model', 'Database responsibilities', 'Ranking architecture',
        'Telegram responsibilities', 'Cron responsibilities and durable work',
        'Failure isolation and observability', 'Security model',
        'Future extension points and explicit deferrals'
    )
    'DATABASE.md' = @(
        'Conceptual ER diagram', 'Core and source tables', 'Profile, feedback, and delivery tables',
        'Work and configuration tables', 'Index strategy', 'Transaction contracts and deduplication',
        'RLS and privileges', 'JSONB rationale and bounds', 'Migration and retention strategy'
    )
    'DATA_SOURCES.md' = @(
        'Evidence policy', 'Preferred source types and evaluation criteria',
        'Confirmed candidate conference sources', 'Confirmed candidate research job and funding sources',
        'Confirmed candidate journal/CFP sources', 'Needs investigation',
        'Rejected or deprioritized approaches', 'Third-party reuse register',
        'Risks and prioritization', 'Source onboarding checklist'
    )
}

foreach ($rrRelative in $rrRequired) {
    if (-not (Test-Path -LiteralPath (Join-Path $rrRoot $rrRelative) -PathType Leaf)) {
        $rrFailures.Add("Missing required file: $rrRelative")
    }
}

$rrDocs = @(Get-ChildItem -LiteralPath $rrRoot -Recurse -File -Filter '*.md' |
    Where-Object { $_.FullName -notmatch '[\\/](\.git|node_modules|\.deno|private|artifacts|backups)[\\/]' })

foreach ($rrDoc in $rrDocs) {
    $rrText = [IO.File]::ReadAllText($rrDoc.FullName)
    $rrRelative = $rrDoc.FullName.Substring($rrRoot.Length + 1).Replace('\', '/')
    if ($rrText.Length -lt 100) {
        $rrFailures.Add("Suspiciously empty document: $rrRelative")
    }
    if ([regex]::IsMatch($rrText, '(?m)[\t ]+$')) {
        $rrFailures.Add("Trailing whitespace: $rrRelative")
    }
    if (([regex]::Matches($rrText, '(?m)^```').Count % 2) -ne 0) {
        $rrFailures.Add("Unbalanced fenced blocks: $rrRelative")
    }
    foreach ($rrLink in [regex]::Matches($rrText, '\[[^\]]*\]\((?<target>[^\s\)]+)\)')) {
        $rrTarget = $rrLink.Groups['target'].Value.Trim('<', '>')
        if ($rrTarget -match '^[A-Za-z][A-Za-z0-9+.-]*:' -or $rrTarget.StartsWith('#')) {
            continue
        }
        $rrTarget = [Uri]::UnescapeDataString(($rrTarget -split '#', 2)[0])
        if (-not $rrTarget) { continue }
        $rrResolved = [IO.Path]::GetFullPath((Join-Path $rrDoc.DirectoryName $rrTarget))
        if (-not $rrResolved.StartsWith($rrRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            $rrFailures.Add("Local link escapes project: $rrRelative -> $rrTarget")
        } elseif (-not (Test-Path -LiteralPath $rrResolved)) {
            $rrFailures.Add("Broken local link: $rrRelative -> $rrTarget")
        }
    }
}

foreach ($rrPhaseId in $rrPhaseIds) {
    $rrPath = Join-Path $rrRoot "harness/build/$rrPhaseId.md"
    if (-not (Test-Path -LiteralPath $rrPath -PathType Leaf)) { continue }
    $rrText = [IO.File]::ReadAllText($rrPath)
    foreach ($rrSection in $rrSections) {
        if (-not [regex]::IsMatch($rrText, '(?m)^## ' + [regex]::Escape($rrSection) + '\r?$')) {
            $rrFailures.Add("Missing phase section '$rrSection': $rrPhaseId")
        }
    }
}

foreach ($rrDocument in $rrDocumentSections.Keys) {
    $rrPath = Join-Path $rrRoot $rrDocument
    if (-not (Test-Path -LiteralPath $rrPath -PathType Leaf)) { continue }
    $rrText = [IO.File]::ReadAllText($rrPath)
    foreach ($rrSection in $rrDocumentSections[$rrDocument]) {
        if (-not [regex]::IsMatch($rrText, '(?m)^## ' + [regex]::Escape($rrSection) + '\r?$')) {
            $rrFailures.Add("Missing required section '$rrSection': $rrDocument")
        }
    }
}

foreach ($rrAdr in @(Get-ChildItem -LiteralPath (Join-Path $rrRoot 'docs/adr') -File -Filter '*.md' -ErrorAction SilentlyContinue)) {
    $rrText = [IO.File]::ReadAllText($rrAdr.FullName)
    foreach ($rrSection in @('Context', 'Decision', 'Alternatives considered', 'Consequences', 'Validation')) {
        if (-not [regex]::IsMatch($rrText, '(?m)^## ' + [regex]::Escape($rrSection) + '\r?$')) {
            $rrFailures.Add("Missing ADR section '$rrSection': $($rrAdr.Name)")
        }
    }
}

$rrPlansPath = Join-Path $rrRoot 'PLANS.md'
if (Test-Path -LiteralPath $rrPlansPath -PathType Leaf) {
    $rrPlans = [IO.File]::ReadAllText($rrPlansPath)
    $rrRows = [regex]::Matches($rrPlans, '(?m)^\| (?<id>\d{2}-[a-z-]+) \| (?<status>pending|active|complete) \|')
    if ($rrRows.Count -ne 10) {
        $rrFailures.Add('PLANS must contain exactly ten recognized phase/status rows.')
    }
    $rrActive = @()
    $rrFoundIncomplete = $false
    for ($rrIndex = 0; $rrIndex -lt $rrRows.Count; $rrIndex++) {
        $rrId = $rrRows[$rrIndex].Groups['id'].Value
        $rrStatus = $rrRows[$rrIndex].Groups['status'].Value
        if ($rrIndex -ge $rrPhaseIds.Count -or $rrId -ne $rrPhaseIds[$rrIndex]) {
            $rrFailures.Add("Phase missing, duplicated or out of order: $rrId")
        }
        if ($rrStatus -eq 'active') { $rrActive += $rrId }
        if ($rrStatus -eq 'complete' -and $rrFoundIncomplete) {
            $rrFailures.Add("Completed phase follows an incomplete dependency: $rrId")
        }
        if ($rrStatus -ne 'complete') { $rrFoundIncomplete = $true }
        if ($rrStatus -eq 'active' -and $rrIndex -gt 0) {
            if ($rrRows[$rrIndex - 1].Groups['status'].Value -ne 'complete') {
                $rrFailures.Add("Active phase has incomplete predecessor: $rrId")
            }
        }
    }
    $rrActiveLine = [regex]::Match($rrPlans, '(?m)^Active phase: (?<id>none|\d{2}-[a-z-]+)\r?$')
    if (-not $rrActiveLine.Success -or $rrActive.Count -gt 1) {
        $rrFailures.Add('Missing/invalid active phase declaration or multiple active phases.')
    } else {
        $rrExpectedActive = 'none'
        if ($rrActive.Count -eq 1) { $rrExpectedActive = $rrActive[0] }
        if ($rrActiveLine.Groups['id'].Value -ne $rrExpectedActive) {
            $rrFailures.Add('Active phase declaration disagrees with roadmap status.')
        }
    }
    $rrFoundationOnly = $rrRows.Count -eq 10 -and $rrRows[1].Groups['status'].Value -eq 'pending'
    if ($rrFoundationOnly) {
        foreach ($rrForbidden in @('supabase/migrations', 'supabase/functions', 'src', 'deno.json', 'package.json')) {
            if (Test-Path -LiteralPath (Join-Path $rrRoot $rrForbidden)) {
                $rrFailures.Add("Premature application/migration scaffold during foundation: $rrForbidden")
            }
        }
    }
}

if ($rrFailures.Count -gt 0) {
    foreach ($rrFailure in $rrFailures) { Write-Output "FAIL: $rrFailure" }
    Write-Output "Documentation validation failed: $($rrFailures.Count) issue(s)."
    exit 1
}

Write-Output "PASS: $($rrDocs.Count) Markdown documents; required files, ten phase contracts/statuses, ADRs, local links, fences and whitespace validated."
Write-Output 'Semantic architecture review and future application/integration checks remain separate requirements.'
exit 0
