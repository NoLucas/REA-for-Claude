<p align="right"><a href="README.md">English</a> | <b>한국어</b> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a></p>

<h1 align="center">REA for Claude</h1>

<p align="center">
  <b>Reverse Engineer Anything — Claude가 있는 모든 곳에서, 설정 없이.</b><br>
  <a href="https://github.com/morluto/rea">REA</a>의 리버스 엔지니어링 툴 207개를 Claude 플러그인으로: 엔진은 알아서 설치되고,
  리버스 엔지니어링 요청은 자동으로 REA로 라우팅되며, 결과는 공유용 리포트가 됩니다.
</p>

<p align="center">
  <a href="https://github.com/NoLucas/REA-for-Claude/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/NoLucas/REA-for-Claude/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Plugin 1.1.0" src="https://img.shields.io/badge/plugin-1.1.0-7b4bd8">
  <img alt="REA 6.7.0" src="https://img.shields.io/badge/rea--agents-6.7.0-informational">
  <img alt="Ghidra 12.1.4" src="https://img.shields.io/badge/Ghidra-12.1.4-ff6f00">
  <img alt="Windows · macOS · Linux" src="https://img.shields.io/badge/os-Windows%20%7C%20macOS%20%7C%20Linux-555">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

<p align="center">
  <a href="#빠른-시작">빠른 시작</a> ·
  <a href="#사용법">사용법</a> ·
  <a href="#분석할-수-있는-대상">분석 대상</a> ·
  <a href="#핵심-기능">핵심 기능</a> ·
  <a href="#업스트림-rea와-다른-점">REA와 다른 점</a> ·
  <a href="#동작-원리">동작 원리</a> ·
  <a href="#커맨드--스킬">커맨드</a> ·
  <a href="#설정">설정</a> ·
  <a href="#문제-해결--faq">FAQ</a> ·
  <a href="#문서">문서</a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/img/hero-ko-dark.svg">
    <img alt="REA for Claude: Windows·macOS·Linux·claude.ai 클라우드에서 REA 툴 207개, 엔진 자동 설치, 리버스 엔지니어링 프롬프트 자동 라우팅" src="docs/img/hero-ko-light.svg" width="100%">
  </picture>
</p>

앱에서 본 기능이 어떻게 동작하는지 궁금하다면 Claude에게 물어보세요. 이 플러그인을 쓰면 Claude가 REA로 소스 코드 없이 프로그램을 검사해서, 기능이 어떻게 동작하는지 설명하고 근거를 보여 주며, 원하면 내 프로젝트에 비슷한 기능까지 만들어 줍니다. 분석은 로컬에서 실행되고, 모든 결론에는 근거와 한계가 함께 붙습니다.

## 빠른 시작

### 설치

```bash
claude plugin marketplace add NoLucas/REA-for-Claude
claude plugin install rea@rea-for-claude
```

**Windows · macOS · Linux** 모두 이게 전부입니다. Java도 Ghidra도 미리 깔 필요 없습니다.

### 어디서 쓰시나요?

| 환경 | 할 일 |
|---|---|
| **Claude Code** (터미널, 모든 OS) | 위 두 줄이면 끝. |
| **Claude Desktop** | 플러그인 설치(또는 아래 `.mcpb` 확장). 끝. |
| **claude.ai 웹·폰, 내 PC와 연결된 세션** | 그 PC의 Claude Desktop에 플러그인이 설치되어 있으면 끝. REA는 내 PC에서 돌고 툴이 세션으로 중계됩니다(`mcp__remote-devices__plugin_rea_rea__*`). 경로는 그 PC 기준이고, PC는 켜 둬야 합니다. |
| **claude.ai 클라우드 세션, PC 연결 없음** | 이 저장소로 세션을 시작하거나, 내 저장소에서 `/rea:setup-mcp` → 생성된 파일 3개 커밋 → 그 저장소로 새 세션. 저장소 없이 시작한 세션은 이 파일들을 보존하지 못합니다. |
| **PC를 꺼도 항상** | [원격 어플라이언스](remote/README.ko.md)를 claude.ai 커스텀 커넥터로. |

잘 모르겠으면 **`/rea:start`**를 입력하세요. 지금 세션에서 REA를 어디서 쓸 수 있는지 확인하고, 고칠 수 있는 건 고치고, 무엇을 물어보면 되는지 알려 줍니다.

<details>
<summary><b>다른 환경</b> — claude.ai 클라우드(PC 없이), Claude Desktop, Docker 어플라이언스</summary>

**claude.ai 클라우드 세션(웹 · 폰 · claude.ai/code)** — 이 저장소를 포크하거나 푸시하고 그 위에서 세션을 시작(또는 채팅에 저장소 첨부)한 뒤 *"`./samples/app.bin` 분석해서 뭐 하는 건지 알려줘"*라고 하세요. `.mcp.json`이 REA를 즉시 띄우고, 같은 훅이 컨테이너에 엔진을 설치합니다(약 2분). 기다리기 싫으면 환경 설정에 `Setup script = bash scripts/install-engines.sh`.

**다른 저장소**에서 클라우드 세션으로 REA를 쓰려면 그 저장소에서 `/rea:setup-mcp`를 한 번 실행하고, 생성된 세 파일(`.mcp.json`, `.claude/rea-mcp.cjs`, `.claude/settings.json`)을 커밋하세요. 다음 세션부터 `mcp__rea__*` 툴이 생깁니다. claude.ai 클라우드 세션은 스킬·훅·명령은 로드하지만 플러그인이 선언한 MCP 서버는 로드하지 않고 프로젝트 수준 서버만 인식하기 때문입니다. 로컬 Claude Code와 Claude Desktop에는 필요 없습니다.

**Claude Desktop** — PC에서 원클릭 확장을 빌드해 설정 › 확장 › 고급 › Install Extension… 으로 설치:

```bash
bash desktop/build-mcpb.sh                                          # macOS / Linux
powershell -ExecutionPolicy Bypass -File desktop\build-mcpb.ps1     # Windows
```

확장은 런처와 설치기를 함께 담고 있어 `~/.rea-engines`를 자동 탐색하고 같은 백그라운드 설치를 시작합니다. 이 PC에 연결된 세션은 웹과 폰의 claude.ai에서도 툴을 쓸 수 있습니다. 태그 릴리스에는 3개 OS용 서명된 `.mcpb`가 올라갑니다.

**원격 어플라이언스(PC 꺼도 됨)** — Cloudflare 터널과 OAuth 2.1 게이트웨이 뒤의 Linux 컨테이너에 REA + 엔진. claude.ai 커스텀 커넥터로 사용:

```bash
cd remote && export REA_UPSTREAM_API_KEY=$(openssl rand -hex 24) GATEWAY_PASSWORD='<12자 이상>'
docker compose -f docker-compose.oauth.yml up --build
```

먼저 [remote/README.md](remote/README.md)의 보안 노트를 읽으세요.

**Windows 참고** — 네이티브 REA는 PE(x86/x64/ARM), Android, 엔진 불필요 프로바이더를 다룹니다. 압축은 내장 `tar.exe`로 풀고 `HTTPS_PROXY`를 따릅니다. Linux 전용 도구(binwalk, tshark, mitmproxy)가 필요하면 `node scripts/install-engines.cjs --wsl` 후 `"use_wsl": true` — 런처가 REA를 WSL 안에서 실행하고 `C:\…` 경로를 `/mnt/c/…`로 변환합니다.

**macOS** — Apple Silicon과 Intel 모두. 맞는 Temurin JDK와 Ghidra의 `mac_arm_64` / `mac_x86_64` 디컴파일러가 자동으로 선택되고, 격리 속성을 지워 Gatekeeper 경고가 뜨지 않습니다.

**직접 제어하려면** — `"auto_engines": false`로 자동 설치를 끄고, `/rea:install-engines`(또는 `node scripts/install-engines.cjs --dry-run`)로 원할 때 설치하며, `ghidra_install_dir` / `jadx_mcp_jar` / `java_home`으로 직접 설치한 경로를 지정합니다.
</details>

### 요청하기

```text
Notes 앱의 검색 기능이 어떻게 작동하는지 조사하고, 근거를 보여 준 다음, 내 프로젝트에 비슷한 기능을 구현해 줘.
```

Notes를 대상 앱으로 바꾸고, 이해하고 싶은 기능을 적으세요. 더 많은 예시는 [사용법](#사용법)에 있습니다.

### 업데이트

```bash
claude plugin marketplace update rea-for-claude
claude plugin update rea@rea-for-claude
```

업데이트한 뒤 Claude를 다시 시작하세요. 플러그인은 REA(`rea-agents` 6.7.0)와 Ghidra 12.1.4 버전을 고정합니다. 플러그인을 업데이트하면 고정 버전이 바뀌고, `/rea:install-engines --upgrade`가 새 엔진 버전을 설치합니다.

> **법적 고지.** 리버스 엔지니어링은 대상의 라이선스, 이용약관, 현지 법을 지켜야 합니다. 사용 전에 업스트림 REA의 [DISCLAIMER](https://github.com/morluto/rea/blob/main/DISCLAIMER.md)를 읽어 주세요.

## 사용법

REA는 소스 코드 없이 프로그램을 검사해서, 기능이 어떻게 동작하는지 **근거와 함께** 설명해 줍니다. 이 플러그인에서는 명령어나 툴 이름을 외울 필요가 없습니다. 분석할 파일을 알려 주고, 알고 싶은 것을 Claude에게 말로 요청하면 됩니다.

### 이렇게 요청하세요

```text
Notes 앱의 검색 기능이 어떻게 작동하는지 조사하고, 근거를 보여 준 다음, 내 프로젝트에 비슷한 기능을 구현해 줘.
C:\Downloads\setup.exe가 뭐 하는 프로그램인지 알려 줘.
~/Downloads/app.apk가 어떤 권한을 쓰고 어느 서버와 통신하는지 분석해 줘.
/Applications/Notion.app/Contents/Resources/app.asar에서 클립보드 기능이 렌더러에서 메인 프로세스까지 어떻게 이어지는지 추적해 줘.
./build/v1.2/agent와 ./build/v1.3/agent에서 바뀐 함수를 비교해 줘.
firmware.bin을 풀어서 안에 뭐가 들어 있는지 보여 줘.
```

- **파일은 절대 경로로** 알려 주세요. 어디에 두어야 하는지는 [분석할 파일은 어디에](#분석할-파일은-어디에)를 보세요.
- **목표를 함께 말하면** 좋습니다("통신하는 서버", "라이선스 확인 로직", "바뀐 부분"). Claude가 전체를 덤프하지 않고 필요한 함수만 따라갑니다.
- "분석", "디컴파일", "리버싱", "뭐 하는 앱이야" 같은 요청은 **자동으로 REA로 라우팅**됩니다. 라우팅되지 않았다면 `/rea:why`가 이유를 알려 주고, `/rea:analyze <경로> [목표]`로 직접 시작할 수도 있습니다.

### 분석은 이렇게 진행됩니다

1. **대상 열기** — 파일 형식과 아키텍처를 확인하고(ELF, PE, Mach-O, APK, ASAR …) 맞는 엔진을 고릅니다.
2. **개요 한 번** — 함수·문자열·세그먼트 수, 클래스 목록, 모듈 그래프처럼 전체 지도를 먼저 만듭니다.
3. **필요한 곳만 깊게** — 문자열 검색, 의사 코드(디컴파일), 호출 관계, 참조를 목표에 맞춰 따라갑니다.
4. **근거와 함께 답변** — REA의 모든 결과에는 근거(Evidence)와 한계가 붙습니다. Claude는 이를 바탕으로 설명하고, 필요하면 비슷한 기능을 구현하고 테스트합니다.

분석은 REA가 실행되는 머신 안에서 이뤄지고 대상 파일을 업로드하지 않습니다. 다만 Claude가 받는 툴 결과(디컴파일 코드, 문자열 등)는 대화의 일부가 됩니다.

### 분석할 파일은 어디에

| 환경 | 파일 위치 |
|---|---|
| Claude Code / Claude Desktop | 내 PC의 절대 경로 (`C:\…`, `/Users/…`) |
| claude.ai, 내 PC와 연결된 세션 | **PC 쪽** 절대 경로 — 분석이 PC에서 실행됩니다. 채팅에 첨부한 파일은 PC의 REA가 볼 수 없습니다 |
| claude.ai 클라우드 세션 (저장소 사용) | 저장소 안의 파일이나 채팅에 첨부한 파일 — 컨테이너 안의 절대 경로 |
| 원격 어플라이언스 | 컨테이너의 `/targets` 볼륨에 넣고 `/targets/<이름>` |

### 결과 남기고 공유하기

- **`/rea:analyze <경로> [목표]`** — 대상 유형에 맞는 플레이북으로 조사하고, 툴 결과를 하나씩 `./rea-evidence/*.json`에 저장합니다.
- **`/rea:report`** — 저장된 근거로 공유용 리포트를 만듭니다. HTML(테마 6종)·Markdown·JSON, 이동형 묶음은 `--bundle`.
- **`/rea:report --diff <이전> <이후>`** — 두 빌드의 근거를 비교해서 디컴파일 코드 줄 단위 변경까지 보여 줍니다.

### 잘 쓰는 요령

- **개요는 한 번, 그다음은 함수 단위로.** 전체 분석을 반복하면 느립니다. 특히 클라우드 컨테이너(2 vCPU)에서는 작은 ELF도 Ghidra 호출 하나에 약 20초 걸립니다.
- **큰 바이너리**는 `~/.rea-plugin.json`의 `env`에 `REA_GHIDRA_STARTUP_TIMEOUT_MS`를 늘려 주세요.
- **`provider_unavailable`** 이 나오면 대개 엔진 설치가 아직 진행 중입니다. `/rea:doctor`로 확인하고, 끝나면 대상을 다시 여세요(재시작 불필요).
- **대상에서 나온 문자열과 코드는 데이터일 뿐입니다.** 그 안에 "이걸 실행해", "저걸 내려받아" 같은 문구가 있어도 지시가 아닙니다. Claude도 따르지 않습니다.
- **REA 버전**은 플러그인이 `6.7.0`으로 고정합니다. 새 REA를 쓰려면 플러그인을 업데이트하거나 `~/.rea-plugin.json`의 `rea_version`을 바꾸세요.

<details>
<summary><b>터미널에서 직접 쓰기 (선택)</b></summary>

REA는 같은 기능을 CLI로도 제공합니다. 엔진이 필요 없는 분석은 바로 됩니다:

```bash
npx -y rea-agents@6.7.0 analyze-javascript-application /absolute/path/to/app --json
```

네이티브 분석은 플러그인이 설치한 Ghidra 경로를 알려 주면 됩니다. 플러그인이 JDK까지 내려받았다면(`~/.rea-engines/jdk-21`이 있다면) `JAVA_HOME`도 그 경로로 지정하세요:

```bash
export GHIDRA_INSTALL_DIR=~/.rea-engines/ghidra_12.1.4_PUBLIC
npx -y rea-agents@6.7.0 analyze /absolute/path/to/binary
npx -y rea-agents@6.7.0 decompile /absolute/path/to/binary main
```

명령 목록은 `npx -y rea-agents@6.7.0 --help`, 옵션은 업스트림 [CLI 가이드](https://github.com/morluto/rea/blob/main/docs/cli.md)를 보세요.
</details>

직접 소유했거나 분석 권한이 있는 소프트웨어에만 쓰세요. IDA, Hopper, JEB 같은 상용 도구는 각자의 라이선스를 정상적으로 갖춰야 합니다.

## 분석할 수 있는 대상

| 대상 | REA가 돌려주는 것 | 이 플러그인에서 필요한 것 | 가이드 |
|---|---|---|---|
| 네이티브 바이너리 (EXE/DLL, ELF/SO, Mach-O) | 의사 코드, 어셈블리, 문자열, 심볼, 호출, 참조 | Ghidra — **자동 설치** (IDA·Hopper는 직접 제공 시 선택) | [네이티브 분석](https://github.com/morluto/rea/blob/main/docs/native-investigation.md) |
| Android APK | 매니페스트, 클래스, 디컴파일된 메서드, 참조 | jadx + JDK 21 — **자동 설치** | [Android](https://github.com/morluto/rea/blob/main/docs/android-analysis.md) |
| Android 리소스 | 디코딩된 매니페스트, 문자열 테이블, 로캘, 버전 | apktool — Linux **자동**, 다른 OS는 `engines`에 `"apktool"` 추가 | [리소스](https://github.com/morluto/rea/blob/main/docs/apktool-resource-analysis.md) |
| Flutter 앱 | Dart 스냅샷 해시, ABI별 라이브러리, 엔진 빌드 출처 | 없음 | [Flutter](https://github.com/morluto/rea/blob/main/docs/flutter-analysis.md) |
| JavaScript / Electron | 모듈, 임포트, 소스 맵, 라우트, IPC, 네이티브 애드온 | 없음 (Linux는 procps `ps`) | [앱 분석](https://github.com/morluto/rea/blob/main/docs/javascript-application-workflows.md) |
| .NET 어셈블리 | 메타데이터, CIL 명령, 네이티브 의존성, 빌드 비교 | 없음 | [관리 코드](https://github.com/morluto/rea/blob/main/docs/managed-code-analysis.md) |
| Go / Rust 바이너리 | 컴파일러 버전, 모듈·크레이트와 버전, 빌드 설정 | 없음 (REA 내장 정적 검사) | [Go](https://github.com/morluto/rea/blob/main/docs/go-binaries.md) · [Rust](https://github.com/morluto/rea/blob/main/docs/rust-binaries.md) |
| WebAssembly | 섹션, import/export, 디코딩된 WAT | WABT 1.0.42 — 직접 제공 | [WASM](https://github.com/morluto/rea/blob/main/docs/wasm-artifacts.md) |
| 펌웨어 | 영역, 추출 결과, 네이티브 분석으로 넘길 정보 | binwalk — Linux **자동**, Windows는 `--wsl` | [펌웨어](https://github.com/morluto/rea/blob/main/docs/firmware-analysis.md) |
| 패킷 캡처 (pcap) | 엔드포인트, DNS, TLS SNI, 프로토콜 분포, HTTP 요청 | tshark — Linux **자동** | [pcap](https://github.com/morluto/rea/blob/main/docs/pcap-analysis.md) |
| 저장된 네트워크 캡처 (HAR) | 요청, 응답, 페이로드, 소스 위치 | 없음 | [캡처](https://github.com/morluto/rea/blob/main/docs/web-network-captures.md) |
| SQLite 데이터베이스 | 테이블, 열, 인덱스, 뷰, 트리거, 선택한 행 | Node.js 24.15+ 또는 26+ | [SQLite](https://github.com/morluto/rea/blob/main/docs/sqlite-databases.md) |
| 웹사이트 | 페이지 구조, 스크립트, 네트워크 관찰, 스크린샷 | Chrome 계열 브라우저 (`browser_executable`) | [브라우저](https://github.com/morluto/rea/blob/main/docs/browser-observation.md) |

이 밖에 EVM 바이트코드, Android 기기(adb), 기록된 크래시, 논리 신호, 프로세스 동작 등 전체 목록과 요구 사항은 [업스트림 REA README](https://github.com/morluto/rea/blob/main/docs/readme/README_ko.md#분석할-수-있는-대상)에 있습니다. 정적 분석(JavaScript, .NET, Go, Rust …)은 대상을 실행하지 않습니다. 런타임 캡처는 사용자 권한으로 대상을 실행하므로, 실행해도 되는 대상에만 쓰세요.

### 사례

업스트림 REA의 실제 분석 사례입니다([rea.tools](https://rea.tools/ko/showcase/)):

- **[DX-Ball](https://rea.tools/ko/showcase/dx-ball/)** — 사운드 호출에서 위치를 패닝 값으로 바꾸는 보조 함수까지 추적해 C로 재구현했습니다. 원본 x86에 대한 3,205개 테스트 케이스를 통과합니다.
- **[Notion](https://rea.tools/ko/showcase/notion/)** — 렌더러의 클립보드 API에서 preload와 IPC를 거쳐 메인 프로세스까지 Electron 클립보드 브리지를 추적합니다.
- **[TH04](https://rea.tools/ko/showcase/th04/)** — 16비트 DOS 게임의 원형 탄막 계산을 복원하고, 재구현한 C++를 당시 컴파일러 출력과 비교합니다.

단계별 안내는 [REA 가이드](https://rea.tools/ko/guides/)에 있습니다.

## 핵심 기능

- **모든 OS에서 무설정 엔진** — JDK 21(필요 시), Ghidra 12.1.4, jadx; 원하면 apktool·radare2. Windows x64, macOS arm64/x64, Linux x64/arm64. 머신당 `~/.rea-engines` 하나를 공유.
- **리버스 엔지니어링이면 REA가 기본** — 40ms짜리 `UserPromptSubmit` 라우터가 영어·한국어·중국어·일본어 리버스 엔지니어링 프롬프트를 알아보고 REA 툴과 맞는 플레이북을 Claude에게 넘깁니다. allow/deny 패턴으로 조정하거나 끌 수 있고, `/rea:why`가 판단 이유를 설명합니다.
- **자가 복구** — `/rea:doctor`가 디스크 상태(반쯤 풀린 Ghidra, `javac` 없는 JRE, 잘린 jar, 오래된 버전)를 검증하고 정확한 복구 명령을 출력합니다.
- **이어받기·오프라인 설치** — 끊긴 다운로드는 이어받고, `~/.rea-engines/archives/`에 넣어 둔 릴리스 파일은 네트워크 없이 설치되며 SHA-256 검사는 그대로. `--upgrade`는 새 버전이 검증된 뒤에만 옛 복사본을 지웁니다.
- **가이드 조사** — `/rea:analyze`가 대상(ELF/PE/Mach-O, APK, Electron, 펌웨어, wasm, Go/Rust/Flutter)별 플레이북을 고르고 모든 결과를 evidence JSON으로 저장합니다.
- **리포트와 diff** — `/rea:report`가 evidence를 독립 실행 HTML(테마 6종)/Markdown/JSON으로 만들고, `--bundle`은 이동형 evidence 파일을, `--diff`는 두 빌드(다른 머신이어도)를 디컴파일 코드 라인 diff까지 비교합니다.
- **어디서든 실행** — 런처 하나가 Claude Code, Claude Desktop(`.mcpb`), claude.ai 클라우드 세션, OAuth 2.1 게이트웨이가 달린 Docker 어플라이언스를 모두 담당합니다.
- **Windows 네이티브** — 내장 `tar.exe` 압축 해제, `cmd.exe` 인용 없는 npx, `C:\` → `/mnt/c/` 변환, `--wsl` 프로비저닝. Windows 11에서 실기 검증.
- **3개 OS 테스트** — `scripts/selftest.mjs`가 CI에서 Windows·macOS·Linux로 돌며, 실제 서버를 띄우는 라이브 MCP 스모크까지 포함합니다. 1.x에서 유지되는 것은 [docs/STABILITY.md](docs/STABILITY.md)에.

## 업스트림 REA와 다른 점

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/img/upstream-vs-plugin-ko-dark.svg">
    <img alt="업스트림 REA: 한 머신에서 수동 5단계. REA for Claude: 플러그인 설치 한 줄, 엔진 자동 설치, Claude Code·Claude Desktop·claude.ai 클라우드에서 동작, 리포트와 자가 복구." src="docs/img/upstream-vs-plugin-ko-light.svg" width="100%">
  </picture>
</p>

[REA](https://github.com/morluto/rea)(morluto, MIT)가 엔진입니다: Ghidra·jadx·IDA·Hopper·Kuna와 엔진 불필요 분석기 여럿을 움직이는 MCP 툴 207개. **REA for Claude는 REA를 포크하거나 고치지 않습니다** — 원본 `rea-agents` 패키지를 그대로 실행하고, 그것을 한 줄 설치·무설정·어디서나 쓰는 Claude 플러그인으로 만드는 데 필요한 것만 얹습니다.

| | 업스트림 REA | REA for Claude |
|---|---|---|
| **설치** | JDK 21·Ghidra·jadx를 직접 깔고 경로를 지정한 뒤 `npx rea-agents setup` | `claude plugin install …` — 첫 사용 시 엔진이 알아서 설치 |
| **실행 위치** | 설정한 그 머신, 그 클라이언트 | 3-OS Claude Code · Claude Desktop · claude.ai 클라우드 · Docker 어플라이언스 |
| **사용** | REA를 쓰라고 직접 말하거나, Claude가 `strings`/`objdump`로 대충 봄 | 리버스 엔지니어링 프롬프트를 자동으로 REA로 라우팅(영/한/중/일) |
| **가이드** | REA의 `reverse-engineer-anything` 스킬 | 같은 스킬(동봉) **더하기** 대상별 플레이북과 `/rea:analyze` |
| **결과물** | 채팅 속 툴 결과 | HTML / Markdown / JSON 리포트, evidence 번들, 두 빌드 `--diff` |
| **상태 점검** | `rea doctor`가 빠진 것을 나열 | `/rea:doctor`가 디스크를 검증하고 복구 명령 출력; `--upgrade` |
| **네트워크** | 수동 다운로드 | 이어받기, 프록시 인식, `archives/`에서 오프라인 설치 |
| **Windows** | Ghidra "experimental", WSL은 수동 | 네이티브 설치기, `--wsl` 프로비저닝, Windows 11 실기 검증 |
| **배포** | npm 패키지 | 플러그인 마켓플레이스 + 태그마다 서명된 3-OS `.mcpb` |
| **바꾸지 않는 것** | Kuna·IDA·Hopper·JEB는 사용자 제공; 툴 이름과 evidence 형식은 REA의 것 | 동일 — 플러그인은 툴 결과를 절대 변형하지 않음 |

Linux 한 대에서 Claude Code만 쓰고 Ghidra가 이미 잡혀 있다면 업스트림 REA만으로 충분합니다. 두 번째 머신, Windows 노트북, 폰, Ghidra 없는 팀원, 남에게 보낼 리포트 중 하나라도 등장하는 순간 이 플러그인이 값을 합니다.

## 동작 원리

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/img/architecture-ko-dark.svg">
    <img alt="아키텍처: SessionStart·UserPromptSubmit 훅과 런처가 원본 REA MCP 서버를 감싸고, 스스로 설치되는 ~/.rea-engines 디렉터리를 읽는 구조" src="docs/img/architecture-ko-light.svg" width="100%">
  </picture>
</p>

의존성 없는 작은 Node 스크립트 셋이 원본 REA 서버를 감쌉니다:

- **`ensure-engines.cjs`**(SessionStart, 0.2초) — `~/.rea-engines`를 확인하고 Ghidra·jadx·JDK 21+ 중 빠진 게 있으면 `install-engines.cjs`를 분리 실행한 뒤 세션에 상태 한 줄을 남깁니다. 배타 락 덕분에 훅과 런처가 동시에 떠도 설치기는 하나만 돕니다.
- **`launch-rea.cjs`** — 모든 엔진 경로를 해석하고(REA 환경변수 › `REA_PLUGIN_*` › `~/.rea-plugin.json` › 자동 탐색) `JAVA_HOME`·`PATH`를 내보내며, REA가 거부하는 빈 값을 걸러낸 뒤 `npx rea-agents@6.7.0 mcp`(Windows에선 선택적으로 WSL 안의 REA)를 띄웁니다. REA는 호출 시점에 프로바이더를 찾으므로 나중에 설치가 끝난 엔진도 재시작 없이 잡힙니다.
- **`rea-router.cjs`**(UserPromptSubmit, 40ms) — 리버스 엔지니어링 프롬프트에 *"REA 툴과 이 플레이북을 써라"* 컨텍스트를 더합니다. 그 외 프롬프트는 건드리지 않습니다.

JDK를 내려받는 이유: Ghidra는 `javac`가 있는 64비트 JDK 21+가 필요합니다. 설치기는 `JAVA_HOME`, `PATH`, `~/.rea-engines/jdk-21`, 흔한 설치 위치(IntelliJ `~/.jdks`, Program Files, Homebrew, `/usr/lib/jvm`, sdkman)를 모두 확인한 뒤에만 Temurin을 받습니다 — REA 자체의 `ghidra-java` doctor 검사로 확인했습니다.

### 첫 실행

1. **첫 세션** — `SessionStart` 훅이 비어 있는 `~/.rea-engines`를 보고 설치기를 백그라운드로 띄웁니다. Claude에게는 `REA: installing JDK 21 + Ghidra + jadx for windows/x64 … (~810 MB, usually 1–5 min)` 한 줄이 전달됩니다.
2. **설치기** — OS/CPU에 맞는 빌드를 고릅니다: Temurin JDK 21(PC에 JDK 21+가 없을 때만), Ghidra 12.1.4(SHA-256 검증), jadx-headless-mcp 0.7.1; Linux는 apt 도구, 원하면 apktool / radare2.
3. **그동안** — REA는 이미 떠 있습니다. 엔진이 필요 없는 프로바이더는 바로 동작하고, Ghidra/jadx 툴은 `install.done`이 생길 때까지 `provider_unavailable`을 돌려줍니다. 그 뒤 대상을 `open_binary`로 다시 열면 됩니다(재시작 불필요).
4. **그 다음부터** — 그냥 말하면 됩니다. *"이 app.apk 뭐 하는 앱이야?"*, *"what does agent.exe do?"*는 리버스 엔지니어링으로 인식되어 맞는 플레이북과 함께 REA로 갑니다. `/rea:analyze <파일>`, `/rea:report`, `/rea:doctor`는 필요할 때 쓰세요.

## 커맨드 & 스킬

| 커맨드 | 하는 일 |
|---|---|
| `/rea:start` | 여기서 시작: 지금 세션에서 REA를 어디서 쓸 수 있는지(여기, 연결된 내 PC, 아직 불가), 고칠 것, 물어볼 것 |
| `/rea:analyze <경로> [목표]` | 대상 유형 판별 → 맞는 플레이북 실행 → 모든 결과를 `./rea-evidence/*.json`에 저장 |
| `/rea:report [디렉터리] [--format html\|md\|json\|both\|all] [--theme …] [--bundle]` | 공유용 리포트 생성; `--bundle`은 이동형 evidence 파일 작성 |
| `/rea:report --diff <before> <after>` | 두 evidence 세트 또는 번들을 비교한 변경 리포트 |
| `/rea:doctor` | 서버 상태, 엔진별 검증, 정확한 복구 명령 |
| `/rea:install-engines` | 엔진 설치·복구·업그레이드(`--dry-run`, `--only`, `--upgrade`, `--wsl`) |
| `/rea:capabilities` | 이 호스트에서 지금 가능한 REA 기능을 대상 유형별로 |
| `/rea:why [프롬프트]` | 프롬프트가 REA로 라우팅된(안 된) 이유와 조정 방법 |
| `/rea:setup-mcp` | 이 저장소의 `.mcp.json`에 REA 서버 등록 — 플러그인 MCP 서버를 건너뛰는 claude.ai 클라우드 세션용 |

| 스킬 | 용도 |
|---|---|
| `reverse-engineer-anything` | REA 공식 207툴 레퍼런스와 복구 가이드(동봉, MIT) |
| `rea-workflows` | 유형별 플레이북: ELF/PE/Mach-O, APK, Electron/JS, 펌웨어, 웹, Go, Rust, Flutter/Dart, WebAssembly |
| `rea-anywhere` | 환경별 운영 노트: 자동 설치, `provider_unavailable`, 파일 위치 |

## 설정

전부 선택 사항입니다. `~/.rea-plugin.json`(또는 `$REA_PLUGIN_CONFIG`); 값별 우선순위: **REA 환경변수 → `REA_PLUGIN_*` 환경변수 → 설정 파일 → `~/.rea-engines` 자동 탐색**. 키와 엔진 레이아웃은 [1.x 동안 유지](docs/STABILITY.md)됩니다.

<details>
<summary><b>모든 키</b></summary>

```jsonc
{
  "rea_version": "6.7.0",
  "ghidra_install_dir": "C:\\tools\\ghidra_12.1.4_PUBLIC",   // ~/.rea-engines 대신 직접 설치한 것을 쓸 때
  "jadx_mcp_jar": "C:\\tools\\jadx-headless-mcp-0.7.1-all.jar",
  "kuna_command": "", "ida_mcp_config": "", "browser_executable": "",
  "java_home": "",                         // 환경변수 JAVA_HOME → 이 값 → 자동 탐지한 JDK 순
  "engines_dir": "",                       // 기본 ~/.rea-engines
  "auto_engines": true,                    // 첫 사용 시 백그라운드 설치
  "jdk": true,                             // JDK 21+가 없을 때 Temurin 다운로드 허용
  "engines": ["ghidra", "jadx", "apt"],    // + "apktool", "radare2"
  "optional_engines": false,               // "all"에 apktool/radare2 포함
  "archive_dir": "",                       // 오프라인 설치용 미리 받은 릴리스 파일
  "router": { "allow": [], "deny": [] },   // 정규식; false면 라우팅 끔
  "use_wsl": false, "wsl_distro": "Ubuntu",
  "rea_command": "",                       // 예: 전역 설치면 "rea"
  "report": { "format": "html", "dir": "rea-reports", "theme": "violet" },
  "env": { "REA_GHIDRA_STARTUP_TIMEOUT_MS": "600000" }
}
```

| 키 | 기본값 | 설명 |
|---|---|---|
| `auto_engines` | `true` | Ghidra가 없으면 백그라운드 설치 |
| `jdk` | `true` | 쓸 만한 JDK 21+가 없을 때만 Temurin JDK 21을 `~/.rea-engines/jdk-21`에 다운로드 |
| `engines` | `["all"]` | `apt` = radare2, binwalk, tshark, apktool, binutils, gdb(Linux); `apktool`, `radare2`는 모든 OS에서 선택 |
| `optional_engines` | `false` | `all`에 선택 엔진 포함 |
| `archive_dir` | — | 릴리스 파일 디렉터리 추가(`~/.rea-engines/archives/`는 항상 확인) |
| `router` | `true` | `false`면 라우팅 끔; `{ "allow": [정규식], "deny": [정규식] }`로 조정; 프로젝트 `.rea-plugin.json`이 우선 |
| `report.format` / `dir` / `theme` | `html` / `rea-reports` / `violet` | 테마: `violet` `ocean` `forest` `amber` `mono` `contrast` |
| `use_wsl` / `wsl_distro` | `false` / `Ubuntu` | Windows 전용; 엔진 경로는 자동으로 Linux 경로가 됨 |
| `env` | — | REA에 넘길 추가 변수(타임아웃, 스키마 프로필 …) |

환경변수 대응: `REA_PLUGIN_CONFIG`, `REA_PLUGIN_ENGINES_DIR`, `REA_PLUGIN_ARCHIVE_DIR`, `REA_PLUGIN_ENGINES`, `REA_PLUGIN_OPTIONAL_ENGINES=1`, `REA_PLUGIN_AUTO_ENGINES=0|1`, `REA_PLUGIN_SKIP_JDK=1`, `REA_PLUGIN_ROUTER=0`, `REA_PLUGIN_USE_WSL=1`, `REA_PLUGIN_VERSION`, 그리고 REA 기본 변수(`GHIDRA_INSTALL_DIR`, `REA_JADX_MCP_JAR`, `REA_KUNA_COMMAND`, `REA_IDA_MCP_CONFIG`, `JAVA_HOME`).
</details>

## 벤치마크

| | Windows 11 x64 (Node 24, 가정용 회선) | Linux x64 (클라우드 컨테이너, 2 vCPU) |
|---|---|---|
| 빈 디렉터리에 전체 엔진 설치 | **26초** — JDK 21 + Ghidra + jadx + apktool + radare2, SHA-256, `tar.exe` | **약 45초** — JDK 21 + jadx 15초, Ghidra 30초 |
| `selftest.mjs`(라이브 MCP 스모크 포함) | win32에서 **207 툴** 서빙 | 207 툴 |
| `launch-rea.cjs doctor` | ghidra·jadx 사용 가능; 네이티브 `win_x86_64` 디컴파일러 일치; JDK 21 승인 | 동일, 내려받은 JDK 승인 |
| 엔진이 있을 때 SessionStart 훅 | 0.2초 | 0.2초 |
| 라우터 판단 | 약 40ms | 약 40ms |
| 작은 ELF Ghidra 디컴파일 | — | 호출당 약 20초 |

PC에 이미 있는 JDK(IntelliJ `~/.jdks`, Temurin, Homebrew, apt)는 찾아서 재사용합니다 — 중복 다운로드 없음. 이어받기: apktool 5 MB 부분 파일을 1초 안에 이어받아 검증.

## 문제 해결 & FAQ

<details>
<summary><b>문제 해결</b></summary>

| 증상 | 원인 | 해결 |
|---|---|---|
| Ghidra / jadx `provider_unavailable` | 백그라운드 설치가 진행 중이거나 실패 | `/rea:doctor`로 상태와 로그 확인; `/rea:install-engines`로 복구; 그 뒤 `open_binary` 다시 |
| `spawn npx.cmd EINVAL`(Windows) | Node 22+가 셸 없이 `.cmd` 실행을 거부 | 런처에서 해결됨(`npx-cli.js`를 Node로 직접 실행) — 플러그인 업데이트 |
| `GHIDRA_INSTALL_DIR must be absolute` | 호스트가 빈 설정을 `""`로 넘김 | 런처가 빈 값을 버림; 직접 지정한다면 전체 경로 사용 |
| Claude Desktop에 `rea` 서버가 안 보임 | MSIX 빌드는 다른 `claude_desktop_config.json`을 읽음 | `.mcpb`로 설치 |
| `.ps1 cannot be loaded … execution policy` | 기본 정책이 스크립트 차단 | `powershell -ExecutionPolicy Bypass -File …` |
| Defender가 Ghidra zip을 잡거나 압축 해제가 느림 | 작은 파일이 많은 큰 아카이브 | `%USERPROFILE%\.rea-engines` 예외 추가; SHA-256이 무결성 보장 |
| 큰 바이너리에서 타임아웃 | 헤드리스 분석이 느림 | `env`의 `REA_GHIDRA_STARTUP_TIMEOUT_MS`를 올리고, 한 번 분석한 뒤 함수 단위 호출 |
| claude.ai 클라우드 세션에 `mcp__rea__*` 툴이 없고 Claude가 grep으로 "분석"함 | 클라우드 세션은 플러그인이 선언한 MCP 서버를 건너뜀(`CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS=1`) | 세션이 내 PC와 연결되어 있고 그 PC의 Claude Desktop에 플러그인이 있으면 REA 툴은 `mcp__remote-devices__plugin_rea_rea__*`로 이미 있음. 아니면 이 저장소에서 세션을 열거나, 내 저장소에서 `/rea:setup-mcp` 실행 → 커밋 → 새 세션. SessionStart 한 줄과 `/rea:doctor`가 서버 미로드 상태를 알려줌 |
| 다운로드 차단 | 프록시 / 허용 목록 | `github.com`, `objects.githubusercontent.com`, `release-assets.githubusercontent.com`, `api.adoptium.net` 허용 — 또는 파일을 `~/.rea-engines/archives/`에 넣기 |

`node scripts/selftest.mjs`로 어느 OS에서든 플러그인 자체를 점검할 수 있습니다.
</details>

<details>
<summary><b>FAQ</b></summary>

**폰의 claude.ai에서도 되나요?** 네 — 이 저장소를 붙인 클라우드 세션은 Anthropic 컨테이너에서 REA를 돌리고, PC에 연결된 세션은 데스크톱 앱의 로컬 REA 툴을 중계합니다.

**Ghidra나 Java를 직접 설치해야 하나요?** 아니요. 첫 세션이 빠진 것을 설치하고, 이미 있는 JDK는 재사용합니다. 직접 설치한 Ghidra를 쓰려면 `ghidra_install_dir`을 지정하세요.

**자동 설치되지 않는 엔진은?** IDA, Kuna, Hopper, JEB(상용 또는 수동). 설정에 본인 설치 경로를 적어 주세요.

**자동 라우팅을 끌 수 있나요?** `"router": false`, 또는 한 세션만 `REA_PLUGIN_ROUTER=0`. allow/deny 정규식으로 사용자별·프로젝트별로 더 세밀하게 조정할 수 있습니다.

**이미 `npx rea-agents setup`을 실행했어요.** 클라이언트당 등록은 하나만 남기세요. 아니면 `rea` 서버가 둘 뜹니다.

**오프라인 / 폐쇄망?** 릴리스 파일을 같은 이름으로 `~/.rea-engines/archives/`에 넣고 `/rea:install-engines`를 실행하세요.

**REA가 내 파일을 업로드하나요?** 아니요. 분석은 REA가 실행되는 곳(내 PC, 또는 클라우드 세션의 컨테이너)에서 이뤄집니다. Claude는 툴 결과(디컴파일 코드, 문자열 등)를 받고, 그 내용은 대화의 일부가 됩니다.

**REA는 어떤 코드를 돌려주나요?** 네이티브 코드는 의사 코드와 어셈블리, Android는 디컴파일된 클래스와 메서드, JavaScript/Electron은 복원한 모듈과 그 관계를 돌려줍니다. Claude는 이를 바탕으로 동작을 설명하거나 구현을 작성하고 테스트합니다.

**버그를 만났어요.** 먼저 업데이트하고([업데이트](#업데이트)) 다시 시도하세요. 설치·라우팅·리포트처럼 플러그인 문제는 [이 저장소 이슈](https://github.com/NoLucas/REA-for-Claude/issues)에, REA 툴이 틀린 결과를 내는 문제는 REA 버전·대상 유형·재현 단계와 함께 [업스트림](https://github.com/morluto/rea/issues)에 올려 주세요.
</details>

<details>
<summary><b>저장소 구조</b></summary>

```
.claude-plugin/        plugin.json · marketplace.json (저장소가 마켓플레이스 역할도 함)
hooks/hooks.json       플러그인 훅: SessionStart → ensure-engines.cjs, UserPromptSubmit → rea-router.cjs
.claude/settings.json  저장소 / 클라우드 세션용 같은 훅
.mcp.json              클라우드 / 로컬 세션용 프로젝트 MCP 서버
scripts/
  launch-rea.cjs       범용 런처(`launch-rea.cjs doctor`로 서버와 같은 env에서 doctor 실행)
  ensure-engines.cjs   SessionStart 훅: 확인 → 백그라운드 설치 → 상태 한 줄(--status로 표)
  rea-router.cjs       UserPromptSubmit 훅: RE 프롬프트 → "REA + 이 플레이북 사용"(--why)
  setup-mcp.cjs        /rea:setup-mcp — 플러그인 MCP 서버를 건너뛰는 호스트용 프로젝트 .mcp.json
  rea-mcp-bootstrap.cjs  프로젝트에 .claude/rea-mcp.cjs로 복사됨; 설치된 플러그인의 런처를 찾아 실행
  install-engines.cjs  Windows / macOS / Linux 설치기(JDK 21, Ghidra, jadx, apktool, radare2, WSL)
  rea-engines-lib.cjs  공용: 버전 고정, OS 감지, 설정, 엔진 / JDK 탐색, 검증
  install-engines.sh   Linux / Docker 설치기(Ghidra, jadx, apt)
  install-engines.ps1  스크립트 배포용 PowerShell 전용 설치기
  make-report.mjs      evidence → HTML / Markdown / JSON, 테마, 번들, --diff
  selftest.mjs · .sh   크로스플랫폼 점검(CI) · bash 전용 점검
desktop/               manifest.json · build-mcpb.sh · build-mcpb.ps1  (Claude Desktop .mcpb)
remote/                Dockerfile · docker-compose.yml · docker-compose.oauth.yml · oauth-gateway/
skills/                reverse-engineer-anything · rea-workflows · rea-anywhere
commands/              start · analyze · report · doctor · capabilities · install-engines · setup-mcp · why
docs/                  STABILITY.md · img/ (generate.py가 README 그림을 생성)
.github/workflows/     ci.yml (3-OS selftest) · release.yml (v* 태그에 3-OS 서명 .mcpb)
```
</details>

## 문서

- [REA 가이드](https://rea.tools/ko/guides/) — 그림으로 설명한 단계별 분석
- 업스트림 문서: [목차](https://github.com/morluto/rea/blob/main/docs/index.md) · [설치와 제공자](https://github.com/morluto/rea/blob/main/docs/installation.md) · [CLI와 Evidence](https://github.com/morluto/rea/blob/main/docs/cli.md) · [MCP 계약](https://github.com/morluto/rea/blob/main/docs/mcp-contracts.md)
- 이 플러그인: [대상별 플레이북](skills/rea-workflows/SKILL.md) · [환경별 운영 노트](skills/rea-anywhere/SKILL.md) · [안정성 약속](docs/STABILITY.md) · [원격 어플라이언스](remote/README.ko.md)
- 문제 신고: 플러그인 → [이 저장소 이슈](https://github.com/NoLucas/REA-for-Claude/issues) · REA 툴 → [업스트림 이슈](https://github.com/morluto/rea/issues)

## 기여하기

```bash
git clone https://github.com/NoLucas/REA-for-Claude && cd REA-for-Claude
node scripts/selftest.mjs           # 어느 OS든: 오프라인 점검 + 라이브 MCP 스모크 (REA_SELFTEST_SKIP_MCP=1로 생략)
bash scripts/selftest.sh            # Linux/macOS: OAuth 게이트웨이·엔트리포인트 점검
claude plugin validate --strict .claude-plugin/plugin.json
python3 docs/img/generate.py        # README 그림을 고친 뒤
```

PR 환영합니다 — 플레이북, 엔진 레시피, 리포트 렌더러, macOS 테스트. selftest를 초록으로 유지하고, 최상위 `bin/`은 추가하지 마세요(claude.ai가 그런 플러그인을 거부합니다).

## 라이선스 & 크레딧

플러그인: [MIT](LICENSE). `skills/reverse-engineer-anything/`은 [morluto/rea](https://github.com/morluto/rea)에서 가져왔습니다(MIT, `LICENSE.rea` 참고). REA 자체는 번들하지 않고 실행 시 npm에서 받습니다. Ghidra는 Apache-2.0(NSA); jadx-headless-mcp, apktool, radare2는 각자의 라이선스를 따릅니다. REA, Ghidra, jadx, apktool, radare2 프로젝트와 무관합니다.
