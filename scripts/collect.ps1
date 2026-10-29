# 네이버 시리즈 / 문피아 작품 지표 수집기
# config.json에 적힌 작품들의 조회수·댓글·추천·선호작·순위·이벤트를 읽어 data/ 폴더에 쌓는다.
# 실행: powershell -ExecutionPolicy Bypass -File scripts/collect.ps1

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = Split-Path -Parent $PSScriptRoot
$DataDir = Join-Path $Root 'data'
$Utf8 = New-Object System.Text.UTF8Encoding $false
$Inv = [Globalization.CultureInfo]::InvariantCulture
$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

# 날짜는 모두 한국 시간 기준
$NowKst = [DateTime]::UtcNow.AddHours(9)
$Today = $NowKst.ToString('yyyy-MM-dd')
$Stamp = $NowKst.ToString('yyyy-MM-ddTHH:mm:ss') + '+09:00'
$script:Errors = @()

if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir | Out-Null }

# ---------- 공통 도우미 ----------

function Get-Page([string]$Url, [hashtable]$Headers = @{}) {
    for ($i = 1; $i -le 3; $i++) {
        try {
            $r = Invoke-WebRequest -UseBasicParsing -UserAgent $UA -Headers $Headers -Uri $Url -TimeoutSec 30
            return [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
        } catch {
            if ($i -eq 3) { throw "요청 실패 $Url : $($_.Exception.Message)" }
            Start-Sleep -Seconds (3 * $i)
        }
    }
}

function Get-JsonPage([string]$Url, [hashtable]$Headers = @{}) {
    return (Get-Page $Url $Headers | ConvertFrom-Json)
}

function Find-First([string]$Text, [string]$Pattern) {
    $m = [regex]::Match($Text, $Pattern)
    if (-not $m.Success) { return $null }
    $v = $m.Groups[1].Value -replace '<[^>]+>', ''
    return [Net.WebUtility]::HtmlDecode($v).Trim()
}

# "402.6만", "4.3천", "1.2억", "8,123" -> 정수
function ConvertFrom-KoNumber([string]$Text) {
    if (-not $Text) { return $null }
    $m = [regex]::Match(($Text.Trim() -replace ',', ''), '^([\d.]+)\s*(억|만|천)?')
    if (-not $m.Success) { return $null }
    $n = [double]::Parse($m.Groups[1].Value, $Inv)
    switch ($m.Groups[2].Value) {
        '억' { $n *= 100000000 }
        '만' { $n *= 10000 }
        '천' { $n *= 1000 }
    }
    return [long][Math]::Round($n)
}

function ConvertTo-Array($Value) {
    # 앞의 쉼표: 원소가 0~1개여도 배열 그대로 돌려주기 위함
    return , @($Value | Where-Object { $null -ne $_ })
}

function Get-Prop($Obj, [string]$Name) {
    if ($null -eq $Obj) { return $null }
    $p = $Obj.PSObject.Properties[$Name]
    if ($p) { return $p.Value }
    return $null
}

function Min-Rank($a, $b) {
    if ($null -eq $a) { return $b }
    if ($null -eq $b) { return $a }
    return [Math]::Min([int]$a, [int]$b)
}

# ---------- 순위표 (한 번 실행에 한 번만 받아 여러 작품이 같이 씀) ----------

$script:RankCache = @{}

# 네이버 시리즈 웹소설 일간 TOP100. 카테고리 'ALL' = 전체, 그 외는 장르 코드(208 = 현판 등)
function Get-NaverRanking([string]$Category) {
    $key = "naver:$Category"
    if ($script:RankCache.ContainsKey($key)) { return $script:RankCache[$key] }
    $map = @{}
    $rank = 0
    foreach ($page in 1..5) {
        $h = Get-Page "https://series.naver.com/novel/top100List.series?rankingTypeCode=DAILY&categoryCode=$Category&page=$page"
        $items = $h -split '<div class="top_numb">' | Select-Object -Skip 1
        foreach ($item in $items) {
            $rank++
            $prod = [regex]::Match($item, 'productNo=(\d+)').Groups[1].Value
            if ($prod -and -not $map.ContainsKey($prod)) { $map[$prod] = $rank }
        }
    }
    $script:RankCache[$key] = $map
    return $map
}

# 문피아 투데이 베스트. 유료작은 유료 투데이 베스트, 무료작은 무료 투데이 베스트
function Get-MunpiaRanking([bool]$Free) {
    $key = "munpia:$Free"
    if ($script:RankCache.ContainsKey($key)) { return $script:RankCache[$key] }
    $url = if ($Free) { 'https://www.munpia.com/best/today' } else { 'https://www.munpia.com/best/plsa.eachtoday' }
    $h = Get-Page $url
    $map = @{}
    # 1~5위는 큰 카드(top5-rank), 6위부터는 목록(num) 형태
    $top5 = 'novel/detail/(\d+)"[^>]*>\s*<div class="cover-badge-wrap">\s*<div class="top5-rank">\s*<div>\s*<span class="month">(\d+)<'
    $rest = 'novel/detail/(\d+)"[^>]*>\s*<div class="num">(\d+)</div>'
    foreach ($m in @([regex]::Matches($h, $top5)) + @([regex]::Matches($h, $rest))) {
        $id = $m.Groups[1].Value
        if (-not $map.ContainsKey($id)) { $map[$id] = [int]$m.Groups[2].Value }
    }
    $script:RankCache[$key] = $map
    return $map
}

# ---------- 네이버 시리즈 ----------

function Get-NaverWork([string]$Url) {
    $no = [regex]::Match($Url, 'productNo=(\d+)').Groups[1].Value
    if (-not $no) { throw "네이버 링크에서 productNo를 찾지 못했습니다: $Url" }
    $detailUrl = "https://series.naver.com/novel/detail.series?productNo=$no"
    $h = Get-Page $detailUrl

    $infoAt = $h.IndexOf('class="end_info')
    $infoBlock = if ($infoAt -ge 0) { $h.Substring($infoAt, [Math]::Min(4000, $h.Length - $infoAt)) } else { '' }

    $viewsText = Find-First $h 'class="btn_download"><span>([^<]+)</span>'
    $commentsText = Find-First $h 'id="commentCount">([^<]+)<'
    $ratingText = Find-First $h '<div class="score_area">[\s\S]*?<em>([\d.]+)</em>'
    $totalText = Find-First $h 'totalCount=(\d+)'
    $genreMatch = [regex]::Match($infoBlock, 'genreCode=(\d+)">([^<]+)</a>')

    $status = if ($infoBlock -match '연재중') { '연재중' } elseif ($infoBlock -match '완결') { '완결' } else { $null }
    $badges = @([regex]::Matches($h, '<em class="ico_end_head[^"]*">\s*([^<]+?)\s*</em>') |
        ForEach-Object { $_.Groups[1].Value.Trim() } | Select-Object -Unique)

    # 연재 시작일 = 1화 등록일, 최근 연재일 = 최신화 등록일
    $ref = @{ Referer = $detailUrl }
    $startDate = $null; $lastDate = $null
    try {
        $asc = Get-JsonPage "https://series.naver.com/novel/volumeList.series?productNo=$no&sortOrder=ASC&totalCount=$totalText&page=1" $ref
        $desc = Get-JsonPage "https://series.naver.com/novel/volumeList.series?productNo=$no&sortOrder=DESC&totalCount=$totalText&page=1" $ref
        $first = @($asc.resultData)[0]; $last = @($desc.resultData)[0]
        if ($first -and $first.lastVolumeUpdateDate) { $startDate = $first.lastVolumeUpdateDate.Substring(0, 10) }
        if ($last -and $last.lastVolumeUpdateDate) { $lastDate = $last.lastVolumeUpdateDate.Substring(0, 10) }
    } catch {
        Write-Warning "네이버 회차 목록을 읽지 못했습니다: $($_.Exception.Message)"
    }

    $genreCode = if ($genreMatch.Success) { $genreMatch.Groups[1].Value } else { $null }
    $rankAll = $null; $rankGenre = $null
    try {
        $rankAll = (Get-NaverRanking 'ALL')[$no]
        if ($genreCode) { $rankGenre = (Get-NaverRanking $genreCode)[$no] }
    } catch { Write-Warning "네이버 순위표를 읽지 못했습니다: $($_.Exception.Message)" }

    $events = @($badges | ForEach-Object { @{ key = "badge:$_"; name = $_; detail = '작품 표지 배지'; startedAt = $null } })

    return @{
        info = [ordered]@{
            url = $detailUrl
            productNo = $no
            title = Find-First $h '<div class="end_head">\s*<h2>([\s\S]*?)</h2>'
            author = Find-First $infoBlock '<span>글</span><a[^>]*>([^<]+)</a>'
            publisher = Find-First $infoBlock '<span>출판사</span><a[^>]*>([^<]+)</a>'
            genre = if ($genreMatch.Success) { $genreMatch.Groups[2].Value.Trim() } else { $null }
            genreCode = $genreCode
            status = $status
            rating = if ($ratingText) { [double]::Parse($ratingText, $Inv) } else { $null }
            chapters = if ($totalText) { [int]$totalText } else { $null }
            startDate = $startDate
            lastEpisodeDate = $lastDate
            badges = $badges
            cover = Find-First $h '<meta property="og:image" content="([^"]+)"'
            lastSuccess = $Stamp
            lastError = $null
        }
        row = [ordered]@{
            date = $Today
            platform = 'naver'
            at = $Stamp
            views = ConvertFrom-KoNumber $viewsText
            viewsText = $viewsText
            comments = ConvertFrom-KoNumber $commentsText
            commentsText = $commentsText
            rating = if ($ratingText) { [double]::Parse($ratingText, $Inv) } else { $null }
            chapters = if ($totalText) { [int]$totalText } else { $null }
            rankAll = $rankAll
            rankGenre = $rankGenre
        }
        events = $events
        notices = @()
        chapterList = $null
    }
}

# ---------- 문피아 ----------

function Get-MunpiaWork([string]$Url) {
    $id = [regex]::Match($Url, '/novel/detail/(\d+)').Groups[1].Value
    if (-not $id) { throw "문피아 링크에서 작품 번호를 찾지 못했습니다: $Url" }
    $api = "https://www.munpia.com/api/v1/pc/novel-detail/$id"
    $d = (Get-JsonPage $api).result
    $n = $d.novelInfo
    if (-not $n) { throw "문피아 작품 정보가 비어 있습니다: $id" }

    # 회차 목록 (한 번에 최대 100개)
    $chapters = @()
    $page = 1
    do {
        $res = (Get-JsonPage "$api/chapters?order=ENTRY_FIRST&page=$page&size=100").result
        $list = @($res.list)
        foreach ($c in $list) {
            $chapters += [ordered]@{
                num = $c.num; title = $c.title; date = $c.createdAt.Substring(0, 10)
                views = $c.viewCount; likes = $c.likeCount; comments = $c.commentCount; free = $c.free
            }
        }
        $page++
    } while ($list.Count -eq 100 -and $chapters.Count -lt $res.total -and $page -le 50)

    # 이벤트: 화면에 노출되는 이벤트 정보들을 모은다. 하나가 실패해도 나머지는 계속 읽음
    $events = @()
    foreach ($e in @($n.events) + @($d.events)) {
        if ($null -eq $e) { continue }
        $title = $null
        foreach ($k in 'title', 'name', 'eventTitle', 'eventName') { if (-not $title) { $title = Get-Prop $e $k } }
        if (-not $title) { $title = ($e | ConvertTo-Json -Compress -Depth 5) }
        $events += @{ key = "event:$title"; name = $title; detail = '작품 이벤트'; startedAt = $null }
    }
    try {
        $g = (Get-JsonPage "$api/event/coupon/gold-gauge").result.goldGaugeCouponEventInfo
        if ($g) {
            $end = if ($g.endless) { '상시' } else { "~ $($g.eventEndedAt.Substring(0, 10))" }
            $events += @{ key = 'gold-gauge'; name = '골든 게이지'; detail = "10편 보면 대여권 1개 ($end)"; startedAt = $g.eventStartedAt.Substring(0, 10) }
        }
    } catch { Write-Warning "문피아 골든 게이지 확인 실패: $($_.Exception.Message)" }
    try {
        $gift = (Get-JsonPage "$api/event/coupon/gift").result
        if ($gift.giftCouponEventInfo) {
            $gi = $gift.giftCouponEventInfo
            $gname = Get-Prop $gi 'title'; if (-not $gname) { $gname = '선물 쿠폰' }
            $events += @{ key = "gift:$gname"; name = $gname; detail = '선물 쿠폰 이벤트'; startedAt = $null }
        }
    } catch { Write-Warning "문피아 선물 쿠폰 확인 실패: $($_.Exception.Message)" }
    try {
        $sale = (Get-JsonPage "$api/sale-info").result
        if ($sale.purchase.discountRate -gt 0) {
            $events += @{ key = "discount:$($sale.purchase.discountRate)"; name = "구매 할인 $($sale.purchase.discountRate)%"; detail = "회차당 $($sale.purchase.salePerPrice)골드"; startedAt = $null }
        }
        if ($sale.freeEventChapterCount -gt 0) {
            $events += @{ key = "free-event:$($sale.freeEventChapterCount)"; name = "무료 이벤트 $($sale.freeEventChapterCount)화"; detail = '기간 한정 무료 회차'; startedAt = $null }
        }
    } catch { Write-Warning "문피아 판매 정보 확인 실패: $($_.Exception.Message)" }
    try {
        $binge = (Get-JsonPage "$api/binge-reading").result
        if ($binge.exposureStatus -and $binge.exposureStatus -ne 'NO_VISIBLE') {
            $events += @{ key = 'binge'; name = '몰아보기 이벤트'; detail = $binge.exposureStatus; startedAt = $null }
        }
    } catch { Write-Warning "문피아 몰아보기 확인 실패: $($_.Exception.Message)" }

    $readers = $null
    try {
        $s = (Get-JsonPage "$api/read-statistics").result
        $readers = [ordered]@{
            male = $s.maleCount; female = $s.femaleCount
            age10s = $s.age10sPercent; age20s = $s.age20sPercent; age30s = $s.age30sPercent
            age40s = $s.age40sPercent; age50s = $s.age50sPercent
        }
    } catch { Write-Warning "문피아 독자 통계 확인 실패: $($_.Exception.Message)" }

    $notices = @(@($d.noticeInfo.list) | Where-Object { $_ } | ForEach-Object {
        $date = $null
        foreach ($k in 'createdAt', 'regDate', 'date') { $v = Get-Prop $_ $k; if ($v -and -not $date) { $date = "$v".Substring(0, [Math]::Min(10, "$v".Length)) } }
        @{ id = "$($_.id)"; title = $_.title; date = $date }
    })

    # 연재 요일: period는 일~토 7자리 (1 = 연재)
    $days = @()
    $dayNames = '일', '월', '화', '수', '목', '금', '토'
    if ($n.period -and $n.period.Length -eq 7) {
        for ($i = 0; $i -lt 7; $i++) { if ($n.period[$i] -eq '1') { $days += $dayNames[$i] } }
    }

    $status = if ($n.finish) { '완결' } elseif ($n.pause) { '휴재' } else { '연재중' }
    $rank = $null
    try { $rank = (Get-MunpiaRanking ([bool]$n.free))[$id] }
    catch { Write-Warning "문피아 순위표를 읽지 못했습니다: $($_.Exception.Message)" }

    return @{
        info = [ordered]@{
            url = "https://www.munpia.com/novel/detail/$id"
            novelId = $id
            title = $n.title
            author = $n.authorName
            genres = @($n.genres)
            tags = @($n.tags | ForEach-Object { $_.title })
            status = $status
            free = [bool]$n.free
            group = $n.groupName
            chapters = $n.chapterCount
            freeChapters = $n.freeChapterCount
            characters = $n.characters
            startDate = if ($n.createdAt) { $n.createdAt.Substring(0, 10) } else { $null }
            lastEpisodeDate = if ($n.updatedAt) { $n.updatedAt.Substring(0, 10) } else { $null }
            paidConversionDate = if ($n.paidConversionOpenAt) { $n.paidConversionOpenAt.Substring(0, 10) } else { $null }
            serialDays = $days
            grade = $n.munstarGrade
            rankType = if ($n.free) { '무료 투데이 베스트' } else { '유료 투데이 베스트' }
            cover = $n.coverUrl
            introduction = $n.introduction
            readers = $readers
            lastSuccess = $Stamp
            lastError = $null
        }
        row = [ordered]@{
            date = $Today
            platform = 'munpia'
            at = $Stamp
            views = $n.viewCount
            likes = $n.likeCount
            prefers = $n.preferenceCount
            chapters = $n.chapterCount
            characters = $n.characters
            rank = $rank
        }
        events = $events
        notices = $notices
        chapterList = $chapters
    }
}

# ---------- 기록 병합 ----------

# 같은 날 여러 번 수집하면 수치는 마지막 값으로 덮고, 순위는 그날 최고 순위를 따로 남긴다
function Merge-HistoryRow($History, $Row) {
    $old = $History | Where-Object { $_.date -eq $Row.date -and $_.platform -eq $Row.platform } | Select-Object -First 1
    foreach ($k in 'rankAll', 'rankGenre', 'rank') {
        if (-not $Row.Contains($k)) { continue }
        $Row["${k}Best"] = Min-Rank (Get-Prop $old "${k}Best") $Row[$k]
    }
    $rest = @($History | Where-Object { -not ($_.date -eq $Row.date -and $_.platform -eq $Row.platform) })
    return @($rest + [pscustomobject]$Row | Sort-Object date, platform)
}

# 이번에 보인 이벤트는 이어서 기록하고, 이번에 안 보인 진행 중 이벤트는 종료 처리
function Merge-Events($Events, [string]$Platform, $Observed) {
    $Events = ConvertTo-Array $Events
    $keys = @($Observed | ForEach-Object { $_.key })
    foreach ($o in $Observed) {
        $e = $Events | Where-Object { $_.platform -eq $Platform -and $_.key -eq $o.key -and $_.active } | Select-Object -First 1
        if ($e) {
            $e.lastSeen = $Today
            $e.name = $o.name
            $e.detail = $o.detail
        } else {
            $Events += [pscustomobject][ordered]@{
                platform = $Platform; key = $o.key; name = $o.name; detail = $o.detail
                startedAt = $o.startedAt; firstSeen = $Today; lastSeen = $Today; active = $true
            }
        }
    }
    foreach ($e in $Events) {
        if ($e.platform -eq $Platform -and $e.active -and ($keys -notcontains $e.key)) { $e.active = $false }
    }
    return $Events
}

function Merge-Notices($Notices, [string]$Platform, $Observed) {
    $Notices = ConvertTo-Array $Notices
    foreach ($o in $Observed) {
        if (-not ($Notices | Where-Object { $_.platform -eq $Platform -and $_.id -eq $o.id })) {
            $Notices += [pscustomobject][ordered]@{ platform = $Platform; id = $o.id; title = $o.title; date = $o.date; firstSeen = $Today }
        }
    }
    return $Notices
}

# ---------- 실행 ----------

$config = [IO.File]::ReadAllText((Join-Path $Root 'config.json'), $Utf8) | ConvertFrom-Json
$index = @()

foreach ($w in $config.works) {
    Write-Host "== $($w.name) ($($w.id))"
    $path = Join-Path $DataDir "$($w.id).json"
    $doc = if (Test-Path $path) { [IO.File]::ReadAllText($path, $Utf8) | ConvertFrom-Json } else { $null }

    $history = ConvertTo-Array (Get-Prop $doc 'history')
    $events = ConvertTo-Array (Get-Prop $doc 'events')
    $notices = ConvertTo-Array (Get-Prop $doc 'notices')
    $chapterLists = Get-Prop $doc 'chapters'
    $platformInfo = [ordered]@{}

    foreach ($platform in 'naver', 'munpia') {
        $url = Get-Prop $w $platform
        if (-not $url) { continue }
        $oldInfo = Get-Prop $doc $platform
        try {
            $r = if ($platform -eq 'naver') { Get-NaverWork $url } else { Get-MunpiaWork $url }
            # 연재 시작일은 처음 확인한 값보다 늦어지지 않게 유지 (1화 수정 시 날짜가 바뀌는 경우 대비)
            $oldStart = Get-Prop $oldInfo 'startDate'
            if ($oldStart -and $r.info.startDate -and $oldStart -lt $r.info.startDate) { $r.info.startDate = $oldStart }
            $platformInfo[$platform] = $r.info
            $history = @(Merge-HistoryRow $history $r.row)
            $events = @(Merge-Events $events $platform $r.events)
            $notices = @(Merge-Notices $notices $platform $r.notices)
            if ($null -ne $r.chapterList) {
                $chapterLists = [ordered]@{ $platform = $r.chapterList; updatedAt = $Stamp }
            }
            $v = $r.row.views
            Write-Host "  [$platform] 조회수 $v / 순위 $(($r.row.rankAll, $r.row.rankGenre, $r.row.rank | Where-Object { $_ }) -join ', ')"
        } catch {
            $msg = "[$($w.name) / $platform] $($_.Exception.Message)"
            $script:Errors += $msg
            Write-Warning $msg
            if ($oldInfo) {
                $oldInfo.lastError = "$Stamp $($_.Exception.Message)"
                $platformInfo[$platform] = $oldInfo
            } else {
                $platformInfo[$platform] = [ordered]@{ url = $url; lastSuccess = $null; lastError = "$Stamp $($_.Exception.Message)" }
            }
        }
    }

    $out = [ordered]@{ id = $w.id; name = $w.name; updatedAt = $Stamp }
    foreach ($k in $platformInfo.Keys) { $out[$k] = $platformInfo[$k] }
    $out.history = $history
    $out.events = $events
    $out.notices = $notices
    $out.chapters = $chapterLists

    [IO.File]::WriteAllText($path, (ConvertTo-Json -InputObject $out -Depth 12), $Utf8)
    $index += [ordered]@{ id = $w.id; name = $w.name; platforms = @($platformInfo.Keys); updatedAt = $Stamp }
}

[IO.File]::WriteAllText((Join-Path $DataDir 'index.json'), (ConvertTo-Json -InputObject @{ works = $index; updatedAt = $Stamp } -Depth 6), $Utf8)

if ($script:Errors.Count -gt 0) {
    Write-Host "수집 중 오류 $($script:Errors.Count)건:"
    $script:Errors | ForEach-Object { Write-Host "  $_" }
    exit 1
}
Write-Host "완료: $Stamp"
