# ☁️ Netlify & GitHub 배포 가이드

이제 PC를 꺼도 폰에서 백테스트를 할 수 있도록 설정해 봅시다!

## 1. GitHub에 코드 올리기
1.  **[GitHub 가입](https://github.com/)** (이미 있다면 로그인)
2.  **새 저장소(Repository) 만들기**:
    *   우측 상단 `+` 버튼 -> `New repository`
    *   Repository name: `backtest-app` (원하는 이름)
    *   **Public** (공개) 또는 **Private** (비공개) 선택 (Private 추천)
    *   `Create repository` 클릭
3.  **코드 업로드 (가장 쉬운 방법)**:
    *   방금 만든 저장소 화면에서 `uploading an existing file` 링크 클릭
    *   내 컴퓨터의 `backtest-app` 폴더 안에 있는 **모든 파일과 폴더**를 드래그해서 넣습니다.
    *   아래 `Commit changes` 버튼 클릭
    
    > **⚠️ 중요: .github 폴더는 따로 만들어야 합니다!**
    > 방금 드래그로 올린 파일들에는 `.github` 폴더가 빠져 있을 확률이 높습니다. 확실하게 하기 위해 아래처럼 직접 만들어주세요.
    >
    > 1. 저장소 파일 목록 위 **`Add file`** -> **`Create new file`** 클릭
    > 2. 파일명 칸에 직접 타이핑: `.github/workflows/daily_update.yml` (슬래시 `/`를 치면 폴더가 됩니다)
    > 3. 아래 내용 붙여넣기:
    >    (내 컴퓨터의 `.github/workflows/daily_update.yml` 파일을 메모장으로 열어서 복사하세요)
    > 4. `Commit changes` 클릭

## 2. Netlify와 연결하기
1.  **[Netlify 가입/로그인](https://www.netlify.com/)**
2.  **새 사이트 만들기**:
    *   `Add new site` -> `Import from an existing project`
3.  **GitHub 연결**:
    *   `Deploy with GitHub` 클릭 -> 권한 승인
    *   아까 만든 `backtest-app` 저장소 선택
4.  **배포 설정**:
    *   다른 건 건드리지 말고 맨 아래 **`Deploy backtest-app`** 버튼 클릭
5.  **완료!**:
    *   잠시 후 `https://random-name-123.netlify.app` 같은 주소가 생깁니다.
    *   이 주소로 폰에서 접속하면 됩니다!

## 3. 매일 자동 업데이트 확인
*   이 프로젝트에는 **GitHub Actions**가 설정되어 있습니다.
*   매일 **한국 시간 오전 7시**에 자동으로 야후 파이낸스에서 데이터를 가져와서 Netlify 사이트를 갱신합니다.
*   **수동으로 확인해보기**:
    1.  GitHub 저장소의 `Actions` 탭 클릭
    2.  `Daily Stock Data Update` 클릭
    3.  `Run workflow` 버튼을 눌러보세요.
    4.  초록색 체크가 뜨면 성공! Netlify 사이트도 잠시 후 업데이트됩니다.

---
**💡 팁:** 
*   **폰 홈 화면에 추가**: Netlify 사이트를 폰 브라우저(크롬/사파리)로 열고 '홈 화면에 추가'를 하면 앱처럼 쓸 수 있습니다.
*   **데이터 갱신 안 될 때**: GitHub Actions 탭에서 에러가 났는지 확인해보세요.
