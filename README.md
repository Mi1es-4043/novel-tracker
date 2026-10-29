# 웹소설 조회수 트래커

네이버 시리즈·문피아에 연재 중인 작품의 조회수, 댓글, 좋아요(추천), 선호작, 순위, 이벤트를 매일 자동으로 기록하고 그래프로 보여주는 사이트입니다.
GitHub가 정해진 시간마다 대신 수집하므로 PC를 켜 둘 필요가 없고, 비용도 들지 않습니다.

## 무엇이 기록되나

| | 네이버 시리즈 | 문피아 |
|---|---|---|
| 누적 지표 | 조회수, 댓글 수, 평점 | 조회수, 좋아요(추천), 선호작, 글자 수 |
| 순위 | 장르 일간 TOP100, 전체 일간 TOP100 | 투데이 베스트 TOP200 (유료작은 유료, 무료작은 무료) |
| 연재 정보 | 연재 시작일, 최근 연재일, 회차, 연재 상태 | 연재 시작일, 유료 전환일, 최근 연재일, 회차, 연재 요일 |
| 이벤트 | 표지 배지 (매일10시무료, 타임딜 등) | 골든 게이지, 선물 쿠폰, 할인, 무료 이벤트, 몰아보기 |
| 기타 | | 작가 공지, 회차별 조회수, 독자 성별·연령 |

- 3시간마다 + 매일 밤 11시 50분(한국 시간)에 수집합니다. 하루의 수치는 그날 마지막 수집값, 순위는 그날 가장 높았던 순위를 남깁니다.
- 네이버 시리즈는 사이트가 `402.6만`처럼 반올림해서 보여주기 때문에 하루 증가량에 약간의 오차가 있습니다. 문피아는 정확한 숫자입니다.
- 이벤트는 "작품 페이지에서 처음 보인 날 ~ 마지막으로 보인 날"로 기록합니다. 네이버 기획전(예: 캐스팅 추가 단독)처럼 작품 페이지에 표시되지 않는 이벤트는 잡히지 않습니다.
- 과거 기록은 가져올 수 없고, 처음 올린 날부터 쌓입니다.

## 처음 설정하기 (한 번만)

### 1. 저장소 만들기
1. [github.com](https://github.com)에 로그인합니다 (계정이 없으면 가입).
2. 오른쪽 위 **+** → **New repository**.
3. Repository name에 `novel-tracker` 같은 영문 이름을 적고, **Public**을 선택한 뒤 **Create repository**.
   - 무료 계정에서 웹페이지(GitHub Pages)를 쓰려면 Public이어야 합니다. 조회수는 원래 공개된 정보라 문제없지만, 저장소 내용은 누구나 볼 수 있습니다.

### 2. 파일 올리기
1. 만든 저장소 화면에서 **uploading an existing file** 링크를 누릅니다.
2. 이 폴더(`웹사이트`) 안의 아래 항목을 전부 끌어다 놓습니다.
   - `.github` 폴더, `assets` 폴더, `data` 폴더, `scripts` 폴더
   - `index.html`, `config.json`, `README.md`, `.nojekyll`
   - `.claude` 폴더는 올리지 않아도 됩니다 (내 PC 미리보기용).
3. 아래 **Commit changes**를 누릅니다.
4. 올라간 목록에 `.github/workflows/collect.yml`이 있는지 확인하세요. 이 파일이 자동 수집을 담당합니다.

### 3. 첫 수집 돌려 보기
1. 저장소 위쪽 **Actions** 탭 → 왼쪽 **조회수 수집** → 오른쪽 **Run workflow** → 초록 버튼 **Run workflow**.
2. 1~3분 뒤 초록색 체크가 뜨면 성공입니다. `data` 폴더에 새 기록이 저장됩니다.
3. 빨간 X가 뜨면 눌러서 **작품 지표 수집** 단계의 메시지를 확인하세요. (예: 네이버가 해외 서버 접속을 막는 경우 여기서 드러납니다.)

### 4. 웹페이지 켜기
1. **Settings** 탭 → 왼쪽 **Pages**.
2. **Source**: `Deploy from a branch`, **Branch**: `main` / `/ (root)` → **Save**.
3. 1~2분 뒤 같은 화면 위쪽에 주소가 나옵니다. 보통 `https://내아이디.github.io/novel-tracker/` 입니다. 즐겨찾기 해 두세요.

이후로는 아무것도 하지 않아도 매일 기록이 쌓입니다. 수집이 실패하면 GitHub가 가입 이메일로 알려 줍니다.

## 작품 추가·삭제

저장소에서 `config.json`을 열고 연필(✏️) 아이콘으로 수정한 뒤 **Commit changes**.

```json
{
  "works": [
    {
      "id": "sacheon-cia",
      "name": "사천당가의 CIA 비밀 요원",
      "naver": "https://series.naver.com/novel/detail.series?productNo=14384564",
      "munpia": "https://www.munpia.com/novel/detail/545835"
    },
    {
      "id": "another-work",
      "name": "다른 작품",
      "munpia": "https://www.munpia.com/novel/detail/123456"
    }
  ]
}
```

- `id`는 영문 소문자·숫자·하이픈(-)만 씁니다. 한 번 정하면 바꾸지 마세요 (기록 파일 이름이 됩니다).
- 한 플랫폼에만 있는 작품은 그 링크만 적으면 됩니다.
- 작품 사이에는 쉼표(`,`)가 필요하고, 마지막 작품 뒤에는 쉼표가 없어야 합니다.
- 작품이 두 개 이상이면 화면 위쪽에 작품 선택 메뉴가 나타납니다.

## 내 PC에서 미리 보기 (선택)

```bash
powershell -ExecutionPolicy Bypass -File scripts/collect.ps1
```

```bash
powershell -ExecutionPolicy Bypass -File scripts/serve.ps1
```

첫 번째 명령은 지금 바로 한 번 수집하고, 두 번째 명령은 `http://localhost:8080`에서 대시보드를 띄웁니다 (Ctrl+C로 종료).

## 파일 구성

- `config.json` — 추적할 작품 목록
- `scripts/collect.ps1` — 수집기 (네이버 시리즈 페이지와 문피아 내부 API를 읽음)
- `.github/workflows/collect.yml` — 수집 일정 (GitHub Actions)
- `data/` — 쌓인 기록 (작품별 JSON). 직접 수정하지 마세요.
- `index.html`, `assets/` — 대시보드 화면

## 문제가 생기면

- **Actions가 실행되지 않음**: Actions 탭에서 워크플로가 꺼져 있으면 **Enable workflow**를 누르세요. 저장소에 60일 동안 아무 변화가 없으면 GitHub가 예약 실행을 멈추는데, 이 사이트는 수집할 때마다 기록이 저장되므로 보통은 멈추지 않습니다.
- **수집 저장 단계에서 권한 오류**: Settings → Actions → General → Workflow permissions를 **Read and write permissions**로 바꾸세요.
- **특정 수치가 비어 있음**: 네이버·문피아가 사이트 구조를 바꾸면 수집 코드를 고쳐야 합니다. 화면에 "최근 수집 실패" 안내가 뜨면 이 경우입니다.
