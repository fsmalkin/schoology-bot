# Local app annotations only. This module never contacts Schoology or Telegram.
function Get-LocalAnnotationRequest([string]$Text) {
  $textValue=$Text.Trim(); $operation=$null; $target=$null; $value=$null
  if($textValue -match '(?is)^/(note|status)\s+(.+?)\s+::\s+(.+)$') {
    $operation=$Matches[1].ToLowerInvariant();$target=$Matches[2];$value=$Matches[3]
  } elseif($textValue -match '(?is)^/(clear-status|clear-notes)\s+(.+)$') {
    $operation=$Matches[1].ToLowerInvariant();$target=$Matches[2]
  } elseif($textValue -match '(?is)^add (?:a )?note to "([^"]+)"\s*:\s*(.+)$') {
    $operation='note';$target=$Matches[1];$value=$Matches[2]
  } elseif($textValue -match '(?is)^(?:mark|set status for) "([^"]+)" (?:as|to) (.+)$') {
    $operation='status';$target=$Matches[1];$value=$Matches[2]
  } else { return $null }
  $target=$target.Trim().Trim('"');if(-not $target -or $target.Length -gt 500){throw 'Invalid local annotation target'}
  if($operation -in @('note','status')) {
    $value=$value.Trim();$maximum=2000;if($operation -eq 'status'){$maximum=160}
    if(-not $value -or $value.Length -gt $maximum){throw 'Invalid local annotation value'}
  }
  if($target -match '^https?://' -and $target -cnotmatch '^https://bcps\.schoology\.com/assignment/[1-9][0-9]*$'){throw 'Unsupported assignment URL'}
  if($operation -eq 'status') {
    $codes=@{A="Excused (doesn't count)";B='Practice / not for grade';C='No way to fix it';D='No grade put in yet';E='Waiting on teacher';F='Will complete in class'}
    if($codes.ContainsKey($value.ToUpperInvariant())){$value=$codes[$value.ToUpperInvariant()]}
    elseif($value -match '^(?i:submitted|turned in|turn in complete)$'){$value='Submitted'}
    elseif($value -match '^(?i:no action needed|no action|nothing needed|not needed|ignore|ignored)$'){$value=$codes.C}
  }
  return [ordered]@{operation=$operation;target=$target;value=$value}
}

function Read-LocalAnnotations([string]$Path,[string]$Profile,[string]$Term) {
  if(-not [IO.File]::Exists($Path)){return @{format='schoology-local-annotations/v1';profile=$Profile;term=$Term;records=@{};effects=@{}}}
  $data=[IO.File]::ReadAllText($Path)|ConvertFrom-Json -AsHashtable -Depth 20
  if($data.format -cne 'schoology-local-annotations/v1' -or $data.profile -cne $Profile -or $data.term -cne $Term -or $data.records -isnot [System.Collections.IDictionary] -or $data.effects -isnot [System.Collections.IDictionary]){throw 'Local annotation identity mismatch'}
  return $data
}

function Confirm-LocalAnnotationTarget($Request,$Assignment,$Snapshot,[string]$Profile,[string]$Term) {
  if(-not $Assignment -or $Assignment.url -cnotmatch '^https://bcps\.schoology\.com/assignment/[1-9][0-9]*$' -or -not $Assignment.title -or $Assignment.title.Length -gt 500 -or -not $Assignment.course -or $Assignment.course.Length -gt 500){throw 'No unique current assignment resolved; local data unchanged'}
  if(-not $Snapshot -or $Snapshot.profileId -cne $Profile -or $Snapshot.term -cne $Term -or @($Snapshot.assignments).Count -lt 1 -or @($Snapshot.assignments).Count -gt 1000){throw 'Bound current source catalog required'}
  $matches=@($Snapshot.assignments|Where-Object {
    if($_.url -cnotmatch '^https://bcps\.schoology\.com/assignment/[1-9][0-9]*$' -or -not $_.title -or -not $_.course){throw 'Invalid current source catalog'}
    if($Request.target -match '^https://'){return $Request.target -ceq $_.url}
    $titleText=([string]$_.title -replace '\s+',' ').Trim()
    $targetText=($Request.target -replace '\s+',' ').Trim()
    return $targetText -ieq $titleText -or $targetText -ieq (([string]$_.course -replace '\s+',' ').Trim()+' / '+$titleText)
  })
  if($matches.Count -ne 1 -or $matches[0].url -cne $Assignment.url -or $matches[0].title -cne $Assignment.title -or $matches[0].course -cne $Assignment.course){throw 'Current source match is absent, ambiguous or inconsistent'}
  if($Request.target -match '^https://') {
    if($Request.target -cne $Assignment.url){throw 'Resolved assignment does not match requested URL'}
  } else {
    $normalizedTarget=($Request.target -replace '\s+',' ').Trim()
    $normalizedTitle=([string]$Assignment.title -replace '\s+',' ').Trim()
    $qualified=(([string]$Assignment.course -replace '\s+',' ').Trim()+' / '+$normalizedTitle)
    if($normalizedTarget -ine $normalizedTitle -and $normalizedTarget -ine $qualified){throw 'Use the exact assignment title or link; local data unchanged'}
  }
}

function Save-LocalAnnotation($Data,[string]$Path,$Request,$Assignment,[string]$EffectId,$Snapshot) {
  Confirm-LocalAnnotationTarget $Request $Assignment $Snapshot $Data.profile $Data.term
  if($EffectId -notmatch '^telegram-update-[0-9]+$' -or $Data.effects.Contains($EffectId)){throw 'Existing or invalid local effect; do not replay'}
  $key=[string]$Assignment.url
  if(-not $Data.records.Contains($key)){$Data.records[$key]=@{url=$key;course=[string]$Assignment.course;title=[string]$Assignment.title;manualStatus=$null;notes=@()}}
  $record=$Data.records[$key];$before=@{manualStatus=$record.manualStatus;notes=@($record.notes)}
  switch($Request.operation) {
    'note' {$record.notes=@($record.notes)+@(@{id=$EffectId;text=[string]$Request.value;createdAt=[DateTimeOffset]::UtcNow.ToString('o')})}
    'status' {$record.manualStatus=[string]$Request.value}
    'clear-status' {$record.manualStatus=$null}
    'clear-notes' {$record.notes=@()}
    default {throw 'Unsupported local operation'}
  }
  $Data.effects[$EffectId]=@{operation=$Request.operation;url=$key;before=$before;at=[DateTimeOffset]::UtcNow.ToString('o')}
  $serialized=$Data|ConvertTo-Json -Depth 20 -Compress
  $temporary=$Path+'.tmp'
  [IO.File]::WriteAllText($temporary,$serialized,[Text.UTF8Encoding]::new($false))
  [IO.File]::Move($temporary,$Path,$true)
  if([IO.File]::ReadAllText($Path) -cne $serialized){throw 'Local save readback mismatch; do not replay'}
  switch($Request.operation) {
    'note' {return "Saved a local note for $($record.title): $($Request.value)`nSchoology was not changed."}
    'status' {return "Set the local status for $($record.title) to $($Request.value).`nSchoology was not changed."}
    'clear-status' {return "Cleared the local status for $($record.title). Schoology's shown status applies again."}
    'clear-notes' {return "Cleared the local notes for $($record.title). The local change history is retained; Schoology was not changed."}
  }
}

function Get-LocalAnnotationContext($Data) {
  $records=@($Data.records.Values|Where-Object {$_.manualStatus -or @($_.notes).Count -gt 0}|ForEach-Object {@{url=$_.url;course=$_.course;title=$_.title;manualStatus=$_.manualStatus;notes=@($_.notes|ForEach-Object {$_.text})}})
  return ConvertTo-Json -InputObject $records -Depth 10 -Compress
}
