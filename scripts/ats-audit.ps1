param([Parameter(Mandatory=$true)][string]$Path)

$tmp = Join-Path $env:TEMP "ats-audit"
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive $Path $tmp -Force

$doc = Get-Content (Join-Path $tmp "word\document.xml") -Raw
$xml = [xml]$doc
$ns = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
$ns.AddNamespace("w","http://schemas.openxmlformats.org/wordprocessingml/2006/main")

"=== STRUCTURE ==="
"paragraphs:       $($xml.SelectNodes('//w:p',$ns).Count)"
"tables:           $($xml.SelectNodes('//w:tbl',$ns).Count)"
"images/drawings:  $($xml.SelectNodes('//w:drawing',$ns).Count)"
"text boxes:       $($xml.SelectNodes('//w:txbxContent',$ns).Count)"
"headers (files):  $((Get-ChildItem (Join-Path $tmp 'word\header*.xml') -ErrorAction SilentlyContinue).Count)"
"footers (files):  $((Get-ChildItem (Join-Path $tmp 'word\footer*.xml') -ErrorAction SilentlyContinue).Count)"
"bullets (numPr):  $($xml.SelectNodes('//w:numPr',$ns).Count)"
"hyperlinks:       $($xml.SelectNodes('//w:hyperlink',$ns).Count)"

""
"=== FONTS USED ==="
$fonts = @{}
foreach ($r in $xml.SelectNodes('//w:rFonts',$ns)) {
  foreach ($a in 'ascii','hAnsi','cs') {
    $v = $r.GetAttribute("w:$a")
    if ($v) { $fonts[$v] = ($fonts[$v] ?? 0) + 1 }
  }
}
$fonts.GetEnumerator() | Sort-Object -Property Value -Descending | ForEach-Object { "  $($_.Name): $($_.Value)" }

""
"=== HEADINGS (what an ATS sees as section breaks) ==="
foreach ($p in $xml.SelectNodes('//w:p',$ns)) {
  $sty = $p.SelectSingleNode('w:pPr/w:pStyle/@w:val',$ns).Value
  if ($sty -and $sty -match '^Heading') {
    $text = ($p.SelectNodes('.//w:t',$ns) | ForEach-Object {$_.InnerText}) -join ""
    "  [$sty] $text"
  }
}

""
"=== TEXT-ONLY EXTRACTION (what ATS would pull) ==="
$lines = @()
foreach ($p in $xml.SelectNodes('//w:p',$ns)) {
  $t = ($p.SelectNodes('.//w:t',$ns) | ForEach-Object {$_.InnerText}) -join ""
  if ($t.Trim()) { $lines += $t }
}
$joined = $lines -join ' '
"  total non-blank lines: $($lines.Count)"
"  total chars: $($joined.Length)"
"  total words: $(($joined -split '\s+').Count)"

""
"=== SUSPICIOUS CHARACTERS ==="
$em    = ([regex]::Matches($joined, "`u{2014}")).Count
$en    = ([regex]::Matches($joined, "`u{2013}")).Count
$smDQ  = ([regex]::Matches($joined, "[`u{201C}`u{201D}]")).Count
$smSQ  = ([regex]::Matches($joined, "[`u{2018}`u{2019}]")).Count
$nbsp  = ([regex]::Matches($joined, "`u{00A0}")).Count
$zwsp  = ([regex]::Matches($joined, "`u{200B}")).Count
"  em dashes (U+2014):       $em"
"  en dashes (U+2013):       $en"
"  smart double quotes:      $smDQ"
"  smart single quotes:      $smSQ"
"  non-breaking spaces:      $nbsp"
"  zero-width spaces:        $zwsp"
