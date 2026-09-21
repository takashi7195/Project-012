param(
  [int]$Minutes = 30,
  [string]$ProjectRef = 'jxjxqfrtvdpvrifktxsf'
)

$secure = Read-Host 'Supabase log token' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  $end = [DateTime]::UtcNow
  $start = $end.AddMinutes(-1 * [Math]::Max(1, $Minutes))
  $base = "https://api.supabase.com/v1/projects/$ProjectRef/analytics/endpoints/logs"
  $query = "iso_timestamp_start=$([Uri]::EscapeDataString($start.ToString('o')))&iso_timestamp_end=$([Uri]::EscapeDataString($end.ToString('o')))"
  try {
    $response = Invoke-RestMethod -Method Get -Uri "$base`?$query" -Headers @{ Authorization = "Bearer $token" }
    $rows = @($response.result | Where-Object {
      $text = $_.event_message
      $text -and ($text -match 'comment_diagnostic|gemini_')
    })
    if ($rows.Count -eq 0) {
      Write-Output 'No comment_diagnostic or gemini logs found in the requested period.'
    } else {
      $rows | Select-Object timestamp, event_message, level | Format-List
    }
  } catch {
    $detail = $_.ErrorDetails.Message
    if ($detail) { Write-Error $detail } else { Write-Error $_.Exception.Message }
    exit 1
  }
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  Remove-Variable token,secure,ptr -ErrorAction SilentlyContinue
}

