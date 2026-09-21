$secure = Read-Host 'Gemini API key' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  $body = @{
    contents = @(@{ role = 'user'; parts = @(@{ text = 'What is the current weather in Tokyo? Answer briefly and mention the source date if available.' }) })
    tools = @(@{ google_search = @{} })
    generationConfig = @{ maxOutputTokens = 128 }
  } | ConvertTo-Json -Depth 8
  $uri = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent'
  try {
    $response = Invoke-WebRequest -Method Post -Uri $uri -Headers @{ 'x-goog-api-key' = $key } -ContentType 'application/json' -Body $body
    Write-Output ("HTTP status: {0}" -f [int]$response.StatusCode)
    Write-Output $response.Content
  } catch {
    $web = $_.Exception.Response
    if ($web) {
      Write-Output ("HTTP status: {0}" -f [int]$web.StatusCode)
      $reader = [System.IO.StreamReader]::new($web.GetResponseStream())
      try { Write-Output $reader.ReadToEnd() } finally { $reader.Dispose() }
    } else {
      Write-Output $_.Exception.Message
    }
  }
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  Remove-Variable key,secure,ptr,body -ErrorAction SilentlyContinue
}

