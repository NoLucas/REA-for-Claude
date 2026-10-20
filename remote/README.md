# REA 원격 어플라이언스 (폰·웹 어디서든)

PC가 꺼져 있어도, 또는 폰에서도 REA를 쓰고 싶을 때의 구성입니다. REA + 모든 엔진을 Linux
컨테이너에 굽고, Streamable HTTP MCP 엔드포인트로 노출한 뒤 claude.ai **커스텀 커넥터**로
등록합니다. Windows 호환성 문제도 사라집니다(컨테이너는 Linux).

```
claude.ai (웹/폰/데스크톱) ──HTTPS──▶ Cloudflare 터널 ──▶ supergateway ──stdio──▶ rea mcp
                                                              (컨테이너: Ghidra, jadx, radare2 …)
```

## 1. 빌드 & 실행

Docker Desktop(WSL2 백엔드) 또는 아무 Linux 서버에서:

```bash
cd remote
export REA_PATH_SECRET=$(openssl rand -hex 24)
docker compose up --build        # 첫 빌드는 Ghidra 570MB 다운로드 포함, 5~10분
```

`tunnel` 서비스 로그에 `https://xxxx-xxxx.trycloudflare.com` 이 찍힙니다.

## 2. claude.ai에 등록

**Settings → Connectors → Add custom connector** 에 아래 URL 입력:

```
https://xxxx-xxxx.trycloudflare.com/<REA_PATH_SECRET>/mcp
```

등록 후 모든 claude.ai 대화(웹·모바일·데스크톱)와 Claude Code 클라우드 세션에서 REA 툴을 쓸
수 있습니다. Pro/Max/Team/Enterprise 플랜이 필요합니다.

## 3. 분석 대상 넣기

컨테이너 안의 `/targets`가 호스트의 `remote/targets/`에 마운트돼 있습니다. 분석할 파일을
거기 복사하고 Claude에게 `/targets/파일명` 으로 열어 달라고 하면 됩니다.

## 보안 — 꼭 읽으세요

- 이 엔드포인트는 **임의 바이너리를 열고, gdb/Playwright/프로세스 캡처까지 하는 서버**입니다.
  URL을 아는 사람은 누구나 쓸 수 있으므로 `REA_PATH_SECRET`은 길고 무작위여야 하며 절대
  공유하지 마세요. (claude.ai 커넥터 UI에는 커스텀 헤더 입력이 없어, 경로 비밀이 가장 단순한
  방식입니다.)
- 제대로 하려면 OAuth를 붙이세요: Cloudflare Zero Trust의 MCP 서버 포털/Access, 또는
  `fastmcp`·`mcp-auth` 류의 OAuth 2.1 게이트웨이를 supergateway 앞에 두고, claude.ai 커넥터의
  "Advanced settings"에 Client ID/Secret을 넣는 구성이 정석입니다.
- 퀵 터널은 재시작마다 호스트명이 바뀝니다. 고정 호스트명은 named tunnel을 쓰세요.
- 자기 서버에 둘 때는 `-v ./targets:/targets` 외에 다른 볼륨을 주지 마세요. 컨테이너는
  비루트(`rea`) 사용자로 돕니다.

## 검증 상태

- `scripts/install-engines.sh`(Ghidra 12.1.4 SHA-256 검증, jadx, apt 도구)와 REA 6.7.0 +
  Ghidra 디컴파일, supergateway stdio→Streamable HTTP 브리지는 Ubuntu 24.04 컨테이너에서
  실제로 실행해 확인했습니다.
- `docker build` 자체와 Cloudflare 터널은 이 환경에 Docker가 없어 실행하지 못했습니다.
  첫 실행에서 문제가 나면 `docker compose logs rea`를 확인하세요.
