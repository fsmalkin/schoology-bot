# Ephemeral typing and one placeholder, bound to the original inbound request.
# Never stream planner JSON or source rows before application validation.
function Get-RelayThreadParameters($Message) {
  $parameters=@{}
  if($null -ne $Message.message_thread_id){
    if([string]$Message.message_thread_id -notmatch '^[1-9][0-9]*$'){throw 'Invalid inbound thread'}
    $parameters.message_thread_id=[long]$Message.message_thread_id
  }
  return $parameters
}

function Invoke-RelayProgressPulse($Client,$Token,$BotId,$ChatId,$Message,$Receipt,$ReceiptPath,$Progress,[DateTimeOffset]$Now=[DateTimeOffset]::UtcNow) {
  if($Progress.finished){return}
  $thread=Get-RelayThreadParameters $Message
  if(-not $Progress.typingDisabled -and $Receipt.typingAttempts -lt 76 -and ($null -eq $Progress.lastTypingAt -or ($Now-$Progress.lastTypingAt).TotalSeconds -ge 4)){
    $Receipt.typingMaximum=76;$Receipt.typingAttempts++;$Receipt.typingState='RESERVED';Write-RelayJson $ReceiptPath $Receipt
    $parameters=@{chat_id=$ChatId;action='typing'};foreach($key in $thread.Keys){$parameters[$key]=$thread[$key]}
    try {
      $accepted=Invoke-RelayApi $Client $Token 'sendChatAction' $parameters
      if($accepted -ne $true){throw 'Typing readback missing'}
      $Receipt.typingState='ACCEPTED';$Progress.lastTypingAt=$Now
    } catch {$Receipt.typingState='FAILED_OR_AMBIGUOUS_NO_RETRY';$Progress.typingDisabled=$true}
    Write-RelayJson $ReceiptPath $Receipt
  }
  if(($Now-$Progress.startedAt).TotalSeconds -ge 10 -and $Receipt.progressSendAttempts -eq 0){
    if($Receipt.sendAttempts -ne 0){throw 'An original message send is already consumed'}
    $Receipt.progressSendAttempts=1;$Receipt.sendAttempts=1;$Receipt.progressState='SEND_RESERVED';Write-RelayJson $ReceiptPath $Receipt
    $parameters=@{chat_id=$ChatId;text='Working on it...';reply_parameters=@{message_id=$Message.message_id};link_preview_options=@{is_disabled=$true};allow_paid_broadcast=$false}
    foreach($key in $thread.Keys){$parameters[$key]=$thread[$key]}
    $sent=Invoke-RelayApi $Client $Token 'sendMessage' $parameters
    if([string]$sent.chat.id -cne $ChatId -or [string]$sent.from.id -cne $BotId -or $sent.text -cne 'Working on it...' -or $sent.message_id -le 0){throw 'Progress send readback ambiguous; do not replay'}
    $Receipt.progressMessageId=$sent.message_id;$Receipt.progressState='SENT';Write-RelayJson $ReceiptPath $Receipt
  }
}

function Send-RelayFinalReply($Client,$Token,$BotId,$ChatId,$Message,[string]$Text,$Receipt,$ReceiptPath,$Progress) {
  if(-not $Text -or $Text.Length -gt 4096){throw 'Invalid final reply'}
  $Progress.finished=$true
  if($Receipt.progressMessageId){
    if($Receipt.finalEditAttempts -gt 0){throw 'Final edit already consumed'}
    $Receipt.state='FINAL_EDIT_RESERVED';$Receipt.finalEditAttempts=1;Write-RelayJson $ReceiptPath $Receipt
    $sent=Invoke-RelayApi $Client $Token 'editMessageText' @{chat_id=$ChatId;message_id=$Receipt.progressMessageId;text=$Text;link_preview_options=@{is_disabled=$true}}
    if($sent.message_id -ne $Receipt.progressMessageId){throw 'Final edit identity mismatch; do not replay'}
  } else {
    if($Receipt.sendAttempts -gt 0){throw 'Original send already consumed or ambiguous'}
    $Receipt.state='SEND_RESERVED';$Receipt.sendAttempts=1;Write-RelayJson $ReceiptPath $Receipt
    $parameters=@{chat_id=$ChatId;text=$Text;reply_parameters=@{message_id=$Message.message_id};link_preview_options=@{is_disabled=$true};allow_paid_broadcast=$false}
    $thread=Get-RelayThreadParameters $Message;foreach($key in $thread.Keys){$parameters[$key]=$thread[$key]}
    $sent=Invoke-RelayApi $Client $Token 'sendMessage' $parameters
  }
  if([string]$sent.chat.id -cne $ChatId -or [string]$sent.from.id -cne $BotId -or $sent.text -cne $Text -or $sent.message_id -le 0){throw 'Final reply readback mismatch; do not replay'}
  return $sent
}

function Wait-RelayProcess($Process,[int]$MaximumMilliseconds,$OnProgress=$null) {
  $clock=[Diagnostics.Stopwatch]::StartNew()
  while(-not $Process.WaitForExit(1000)){
    if($clock.ElapsedMilliseconds -ge $MaximumMilliseconds){$Process.Kill($true);$Process.WaitForExit();throw 'Worker/tool timed out; do not replay'}
    if($OnProgress){& $OnProgress|Out-Null}
  }
}
