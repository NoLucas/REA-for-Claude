<p align="right"><a href="README.md">English</a> | <b>한국어</b></p>

# REA for Claude — Reverse Engineer Anything, 어디서든

[REA (Reverse Engineer Anything)](https://github.com/morluto/rea)를 **Claude가 실행되는 모든 곳**에서
쓸 수 있게 포장한 플러그인입니다. 원본 REA는 "로컬 stdio MCP 서버 + 로컬 분석 엔진" 구조라
Claude Code 터미널에서만 쓰는 게 전제였는데, 이 저장소는 그 전제를 네 가지 방식으로 풀어냅니다.

| 실행 위치 | 동작 방식 | PC 필요 | 검증 |
|---|---|---|---|
| **claude.ai 클라우드 세션** (웹·폰·claude.ai/code) | 이 저장소를 세션에 붙이면 `.mcp.json`으로 REA가 컨테이너 안에서 뜨고, **Ghidra 12.1.4·jadx가 자동 설치**됨 | ✗ | ✅ 실제 세션에서 Ghidra 디컴파일까지 확인 |
| **Claude Desktop + 연결된 claude.ai 세션** | REA가 PC에서 돌고, 데스크톱 앱이 툴을 세션으로 중계. 폰에서도 이어서 사용 가능 | ✓ (켜져 있어야) | ⚠️ REA 팀이 Windows 11에서 검증한 경로를 그대로 사용 |
| **로컬 Claude Code** | 플러그인 설치 또는 `.mcp.json` | ✓ | ✅ |
| **원격 어플라이언스** (Docker + 터널 → 커스텀 커넥터) | 항상 켜진 서버에 REA+엔진을 굽고 HTTPS로 노출 | 서버 | ⚠️ 구성 요소는 각각 검증, docker build는 미실행 |

> 리버스 엔지니어링은 대상 소프트웨어의 라이선스·약관과 현지 법을 따르세요. REA 원본의
> [DISCLAIMER](https://github.com/morluto/rea/blob/main/DISCLAIMER.md)를 읽어 보세요.

---

## 1. claude.ai 클라우드 세션에서 쓰기 (PC 불필요)

가장 "REA보다 나은" 경로입니다. Anthropic 클라우드 컨테이너(Ubuntu 24.04, JDK 21 내장)에서
REA와 Ghidra가 돌고, 폰에서도 그대로 이어집니다.

1. 이 저장소를 본인 GitHub에 올립니다(비공개 가능).
2. [claude.ai/code](https://claude.ai/code)에서 이 저장소로 새 세션을 시작하거나, 일반 채팅에서
   저장소를 세션에 추가합니다.
3. 세션이 시작되면 `.claude/settings.json`의 SessionStart 훅이 **백그라운드로** 엔진을 설치하고
   (`~/.rea-engines`, 약 1~3분, 로그 `~/.rea-engines/install.log`), `.mcp.json`이 REA 서버를
   즉시 띄웁니다. Ghidra가 필요한 툴은 설치가 끝난 뒤 `open_binary`를 다시 호출하면 됩니다 —
   REA가 프로바이더를 호출 시점에 다시 찾기 때문에 재시작이 필요 없습니다.
4. 분석할 파일은 저장소에 커밋하거나 세션에 첨부하세요. 절대경로로 `open_binary`합니다.

**더 빠르게 (권장):** claude.ai/code → 환경(Environment) 설정에서
- Setup script: `bash scripts/install-engines.sh`
- 환경변수: `GHIDRA_INSTALL_DIR=/root/.rea-engines/ghidra_12.1.4_PUBLIC`,
  `REA_JADX_MCP_JAR=/root/.rea-engines/jadx-headless-mcp-0.7.1-all.jar`

로 두면 세션 시작 전에 설치가 끝나고 결과가 캐시됩니다(홈 경로는 환경에 따라 `/home/…`일 수
있으니 첫 세션에서 `echo $HOME`으로 확인). 네트워크 접근 수준은 기본 **Trusted**면 됩니다
(github.com, release-assets.githubusercontent.com, archive.ubuntu.com 사용).

측정값: 2 vCPU 컨테이너에서 설치 1분 46초, 작은 ELF 디컴파일 호출당 약 20초.

## 2. Claude Desktop (+ 연결된 claude.ai 세션)

PC에서 REA를 돌리고 데스크톱 앱이 툴을 중계하는 방식입니다. 세션을 PC에 연결해 두면 폰에서
이어서 써도 REA 툴이 그대로 보입니다(PC와 데스크톱 앱이 켜져 있어야 함).

```powershell
# 1) Node.js 22/24 설치 후, Claude Desktop을 완전히 종료(트레이까지)하고 일반 터미널에서:
npx rea-agents@6.7.0 setup --client claude_desktop
# 2) Claude Desktop 재시작 → 설정 > 개발자 탭에서 rea 서버가 떠 있는지 확인
```

엔진 경로는 `%USERPROFILE%\.rea-plugin.json`(아래 설정 파일 참고) 대신 시스템 환경변수
(`GHIDRA_INSTALL_DIR`, `REA_JADX_MCP_JAR`)로 주는 편이 REA 공식 setup과 잘 맞습니다.
이 플러그인의 런처를 쓰고 싶으면 `claude_desktop_config.json`의 `rea` 항목을
`node <저장소>/scripts/launch-rea.cjs`로 바꾸면 되고, 그러면 설정 파일과 WSL 모드가 활성화됩니다.

**Windows 한계와 WSL:** 네이티브 Windows REA는 Ghidra x86/x64/ARM PE 대상과 엔진 불필요
프로바이더를 지원하고, binwalk·tshark·mitmproxy 같은 Linux 전용 도구는 못 씁니다.
`~/.rea-plugin.json`에 `"use_wsl": true`를 주면 런처가 `wsl.exe` 안에서 REA를 실행해
Linux 도구를 모두 쓸 수 있습니다(이때 엔진 경로는 Linux 경로). WSL 안에서는
`bash scripts/install-engines.sh`로 엔진을 한 번에 설치할 수 있습니다.

> Claude Desktop에 claude.ai 플러그인으로 설치할 때 데스크톱 앱이 플러그인의 MCP 서버를
> 직접 띄우는 경우에 대비해, 이 플러그인의 서버 정의는 **사용자 설정(userConfig)에 의존하지
> 않습니다**(데스크톱은 플러그인 설정값을 공급하지 못해 서버가 시작되지 않음). 모든 설정은
> 환경변수·`~/.rea-plugin.json`·자동 탐색으로 해결됩니다.

## 3. 로컬 Claude Code

```bash
claude plugin marketplace add NoLucas/REA-for-Claude
claude plugin install rea@rea-for-claude
# 또는 저장소를 클론해서
claude --plugin-dir ./REA-for-Claude
```

그 다음 `/rea:doctor`. Linux면 `/rea:install-engines`로 엔진까지 설치됩니다.

## 4. 원격 어플라이언스 (어디서든, PC 꺼져도)

`remote/`의 Dockerfile·docker-compose가 REA + Ghidra + jadx + radare2/binwalk/tshark/apktool을
Linux 컨테이너에 굽고 Streamable HTTP로 노출합니다. Cloudflare 터널을 붙여 claude.ai
**Settings → Connectors → Add custom connector**에 URL을 넣으면 웹·폰·데스크톱·클라우드 세션
전부에서 REA 툴이 보입니다. 자세한 절차와 **보안 주의**는 [remote/README.ko.md](remote/README.ko.md).

---

## 설정 파일 `~/.rea-plugin.json`

모든 키는 선택이고 빈 값은 무시됩니다. 우선순위: 실제 REA 환경변수 → `REA_PLUGIN_*` 환경변수
→ 이 파일 → 엔진 디렉터리 자동 탐색(`~/.rea-engines`).

```json
{
  "rea_version": "6.7.0",
  "ghidra_install_dir": "C:\\tools\\ghidra_12.1.4_PUBLIC",
  "jadx_mcp_jar": "C:\\tools\\jadx-headless-mcp-0.7.1-all.jar",
  "kuna_command": "",
  "ida_mcp_config": "",
  "engines_dir": "",
  "auto_engines": false,
  "use_wsl": false,
  "wsl_distro": "Ubuntu",
  "env": { "REA_GHIDRA_STARTUP_TIMEOUT_MS": "600000" }
}
```

`scripts/rea-config.example.json`을 복사해서 쓰세요. `auto_engines`는 클라우드 세션
(`CLAUDE_CODE_REMOTE`)에서는 기본 켜짐, 그 외에는 기본 꺼짐입니다.

## 구성 요소

```
.claude-plugin/plugin.json      플러그인 매니페스트 (MCP 서버 → scripts/launch-rea.cjs)
.claude-plugin/marketplace.json 저장소 자체가 마켓플레이스
.mcp.json                       클라우드/로컬 세션용 프로젝트 MCP 정의 (승인 없이 자동 로드)
.claude/settings.json           클라우드 세션 SessionStart 훅: 엔진 백그라운드 설치
scripts/launch-rea.cjs          범용 런처 (설정 파일·자동 탐색·클라우드 자동 설치·WSL)
scripts/install-engines.sh      Linux 엔진 설치기 (Ghidra 12.1.4 SHA-256 검증, jadx, apt 도구)
skills/reverse-engineer-anything REA 공식 조사 스킬 (207 툴, MIT)
skills/rea-anywhere             환경별 운영 노트 (provider_unavailable 대처 등)
commands/doctor, capabilities, install-engines
remote/                         Docker 어플라이언스 + Cloudflare 터널
```

## 동작 원리와 설계 근거

- **런처가 중간에 있는 이유** ① 호스트가 빈 설정값을 `""`로 넘기면 REA가 "절대경로가 아님"으로
  거부하므로 빈 값을 걸러야 함 ② 클라우드에서는 서버를 즉시 띄우고 엔진을 뒤에서 받아야 MCP
  시작 타임아웃에 안 걸림 ③ Windows에서 WSL로 넘기는 분기.
- **지연 설치가 가능한 이유** REA는 Ghidra 프로바이더를 서버 시작 시가 아니라 `open_binary`
  시점에 해석합니다(테스트로 확인). 설치 완료 후 대상을 다시 열면 됩니다.
- **`.mcp.json`과 `plugin.json` 둘 다 있는 이유** 클라우드/로컬 세션은 프로젝트 `.mcp.json`을,
  플러그인 설치는 `plugin.json`을 읽습니다. 같은 이름 `rea`라 플러그인 설치 시엔 후자가 이깁니다.
- `rea mcp --http`(네이티브 Streamable HTTP)는 REA 소스 main에는 있지만 npm 6.7.0에는 아직
  없어, 원격 어플라이언스는 `supergateway`로 브리지합니다. 다음 릴리스에서 교체 가능.

## 한계

- 클라우드 컨테이너는 보통 2 vCPU/8 GB라 큰 바이너리는 느립니다. `REA_GHIDRA_STARTUP_TIMEOUT_MS`를
  늘리고, 전체 분석은 한 번만 하고 함수 단위 호출을 쓰세요.
- IDA·Kuna·Hopper는 상용/수동 설치 엔진이라 클라우드 자동 설치 대상이 아닙니다.
- macOS 전용 프로바이더(asset catalog 등)는 macOS에서만 동작합니다.
- 이미 `npx rea-agents setup`으로 같은 클라이언트에 등록해 뒀다면 둘 중 하나만 남기세요.

## 라이선스

플러그인 래퍼: MIT. `skills/reverse-engineer-anything/`는 [morluto/rea](https://github.com/morluto/rea)의
MIT 스킬을 그대로 가져온 것입니다(`LICENSE.rea`). REA 본체는 포함되지 않고 실행 시 npm에서 받습니다.
Ghidra는 Apache-2.0, jadx-headless-mcp는 해당 저장소의 라이선스를 따릅니다.
