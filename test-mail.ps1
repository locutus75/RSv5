# Test Mail Versturen via SMTP Server
Write-Host "Test Mail Versturen" -ForegroundColor Green
Write-Host "=====================" -ForegroundColor Green
Write-Host ""

# SMTP Server configuratie
$smtpServer = "relay.coolservers.org"
$smtpPort = 2525
$from = "info@e-cowarenhuis.nl"
$to = "info@e-cowarenhuis.nl"
$subject = "Test Mail van PowerShell"
$body = "Dit is een test mail om te controleren of de SMTP server werkt."

Write-Host "Verbinding maken met SMTP server..." -ForegroundColor Yellow
try {
    # Maak TCP verbinding
    $tcpClient = New-Object System.Net.Sockets.TcpClient
    $tcpClient.Connect($smtpServer, $smtpPort)
    
    if ($tcpClient.Connected) {
        Write-Host "Verbinding succesvol!" -ForegroundColor Green
        
        $stream = $tcpClient.GetStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $writer = New-Object System.IO.StreamWriter($stream)
        
        # Lees welkomstboodschap
        $response = $reader.ReadLine()
        Write-Host "Server: $response" -ForegroundColor Yellow
        
        # Stuur EHLO
        Write-Host "Stuur EHLO..." -ForegroundColor Yellow
        $writer.WriteLine("EHLO test.local")
        $writer.Flush()
        Start-Sleep -Milliseconds 100
        
        # Lees response
        $response = $reader.ReadLine()
        Write-Host "Server: $response" -ForegroundColor Yellow
        
        # Stuur MAIL FROM
        Write-Host "Stuur MAIL FROM..." -ForegroundColor Yellow
        $writer.WriteLine("MAIL FROM:<$from>")
        $writer.Flush()
        Start-Sleep -Milliseconds 100
        
        $response = $reader.ReadLine()
        Write-Host "Server: $response" -ForegroundColor Yellow
        
        # Stuur RCPT TO
        Write-Host "Stuur RCPT TO..." -ForegroundColor Yellow
        $writer.WriteLine("RCPT TO:<$to>")
        $writer.Flush()
        Start-Sleep -Milliseconds 100
        
        $response = $reader.ReadLine()
        Write-Host "Server: $response" -ForegroundColor Yellow
        
        # Stuur DATA
        Write-Host "Stuur DATA..." -ForegroundColor Yellow
        $writer.WriteLine("DATA")
        $writer.Flush()
        Start-Sleep -Milliseconds 100
        
        $response = $reader.ReadLine()
        Write-Host "Server: $response" -ForegroundColor Yellow
        
        # Stuur mail content
        $mailContent = "From: $from`nTo: $to`nSubject: $subject`n`n$body`n."
        
        $writer.WriteLine($mailContent)
        $writer.Flush()
        Start-Sleep -Milliseconds 100
        
        $response = $reader.ReadLine()
        Write-Host "Server: $response" -ForegroundColor Yellow
        
        # Stuur QUIT
        Write-Host "Stuur QUIT..." -ForegroundColor Yellow
        $writer.WriteLine("QUIT")
        $writer.Flush()
        
        Write-Host "Mail test voltooid!" -ForegroundColor Green
        
    } else {
        Write-Host "Verbinding mislukt" -ForegroundColor Red
    }
    
} catch {
    Write-Host "Fout: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    if ($tcpClient) {
        $tcpClient.Close()
    }
}

Write-Host ""
Write-Host "Test voltooid!" -ForegroundColor Green
