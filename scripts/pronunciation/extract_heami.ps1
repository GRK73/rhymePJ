# Extract Microsoft Heami (Windows ko-KR voice) phoneme events for every word.
# Input : TSV of "lang<TAB>word" lines (UTF-8).
# Output: TSV of "lang<TAB>word<TAB>events" lines, events joined by "|" exactly as
#         reported by SpeechSynthesizer.PhonemeReached (raw, unnormalized).
# Resumable: words already present in the output are skipped.
param(
    [string]$InputPath = "data/derived/pronunciations_heami/v0/words.tsv",
    [string]$OutputPath = "data/derived/pronunciations_heami/v0/heami_raw.tsv",
    [string]$Voice = "Microsoft Heami Desktop"
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$utf8 = New-Object System.Text.UTF8Encoding($false)

$done = New-Object 'System.Collections.Generic.HashSet[string]'
if (Test-Path $OutputPath) {
    foreach ($line in [IO.File]::ReadLines((Resolve-Path $OutputPath), $utf8)) {
        $parts = $line.Split("`t")
        if ($parts.Length -ge 2) { [void]$done.Add($parts[0] + "`t" + $parts[1]) }
    }
}

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice($Voice)
$synth.SetOutputToNull()
$script:events = New-Object System.Collections.Generic.List[string]
$synth.add_PhonemeReached([EventHandler[System.Speech.Synthesis.PhonemeReachedEventArgs]]{
    param($sender, $e) $script:events.Add($e.Phoneme)
})

$writer = New-Object IO.StreamWriter($OutputPath, $true, $utf8)
$writer.NewLine = "`n"
$count = 0; $skipped = 0
$sw = [Diagnostics.Stopwatch]::StartNew()
try {
    foreach ($line in [IO.File]::ReadLines((Resolve-Path $InputPath), $utf8)) {
        $parts = $line.Split("`t")
        if ($parts.Length -lt 2) { continue }
        $key = $parts[0] + "`t" + $parts[1]
        if ($done.Contains($key)) { $skipped++; continue }
        $script:events.Clear()
        $synth.Speak($parts[1])
        $writer.WriteLine($key + "`t" + ($script:events -join '|'))
        $count++
        if ($count % 5000 -eq 0) {
            $writer.Flush()
            "{0:N0} new words, {1:N0} skipped, {2:N1} ms/word" -f $count, $skipped, ($sw.ElapsedMilliseconds / $count)
        }
    }
} finally {
    $writer.Flush(); $writer.Dispose(); $synth.Dispose()
}
"done: {0:N0} new, {1:N0} skipped, {2:N0} s" -f $count, $skipped, ($sw.ElapsedMilliseconds / 1000)
