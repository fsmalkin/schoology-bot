# App-produced list context is committed only after the original final send readback.
function Confirm-RelayDisplayedAssignments($Assignments) {
  $rows=@($Assignments)
  if($rows.Count -gt 100){throw 'Displayed context exceeds list limit'}
  foreach($row in $rows){
    if(-not $row.key -or -not $row.title -or -not $row.course -or
       $row.key.Length -gt 200 -or $row.title.Length -gt 1000 -or $row.course.Length -gt 500 -or
       ($row.url -and $row.url -cnotmatch '^https://bcps\.schoology\.com/assignment/[1-9][0-9]*$') -or
       @($row.PSObject.Properties.Name|Where-Object {$_ -cnotin @('key','title','course','url')}).Count){throw 'Invalid app-displayed assignment context'}
  }
  return $true
}

function New-RelayDisplayedContext($Assignments,$Receipt,$Sent,$Message,$ChatId,$ProfileId,$Term) {
  if($Receipt.state -cne 'SENT' -or $Receipt.replyMessageId -ne $Sent.message_id -or $Sent.message_id -le 0){throw 'Context requires confirmed final send'}
  [void](Confirm-RelayDisplayedAssignments $Assignments)
  $index=0
  $rows=@($Assignments|ForEach-Object {$index++;[ordered]@{index=$index;key=$_.key;title=$_.title;course=$_.course;url=$_.url}})
  return [ordered]@{operationId="telegram-update-$($Receipt.updateId)";replyMessageId=$Sent.message_id;observedAt=$Receipt.observedAt;chatId=$ChatId;profileId=$ProfileId;term=$Term;messageThreadId=[string]$Message.message_thread_id;assignments=$rows}
}

function Get-RelayDisplayedContext($State,$Message,$ProfileId,$Term) {
  $context=$State.lastDisplayedList
  if($null -eq $context){return $null}
  if($context.chatId -cne $State.chatId -or $context.profileId -cne $ProfileId -or $context.term -cne $Term -or $context.messageThreadId -cne [string]$Message.message_thread_id){return $null}
  return $context
}
