<p align="right"><a href="README.md">English</a> | <b>한국어</b></p>

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

## 2b. 경로 비밀 대신 진짜 로그인 (OAuth 2.1)

`docker-compose.oauth.yml`은 REA 앞에 작은 OAuth 2.1 게이트웨이(`oauth-gateway/gateway.mjs`,
의존성 없음)를 둡니다. claude.ai가 자동으로 발견(보호 리소스 메타데이터 → 동적 클라이언트 등록 →
PKCE)하고 로그인 페이지를 한 번 보여준 뒤, 이후엔 회전하는 bearer 토큰을 씁니다. REA 본체는
게이트웨이의 내부 키만 받습니다.

```bash
cd remote
export GATEWAY_PASSWORD='로그인 페이지에 입력할 긴 암호구'        # 12자 이상
export REA_UPSTREAM_API_KEY=$(openssl rand -hex 24)              # 내부 전용
docker compose -f docker-compose.oauth.yml up --build
# 터널 로그의 https://<random>.trycloudflare.com URL을 읽고, 한 번만:
export PUBLIC_URL=https://<random>.trycloudflare.com && docker compose -f docker-compose.oauth.yml up -d
```

커스텀 커넥터에 `https://<host>/mcp`를 넣으세요. 게이트웨이 재시작(또는 state 볼륨 삭제)으로
모든 토큰이 폐기됩니다. 게이트웨이의 OAuth 흐름 — 메타데이터, 등록, 리다이렉트 허용 목록
(claude.ai / claude.com만), PKCE S256, 암호 오류 잠금, refresh 회전, REA로의 인증 프록시 — 는
`scripts/selftest.sh`가 점검하며, 실제 REA 브리지를 상대로 엔드투엔드 검증했습니다. claude.ai
자체 클라이언트로는 아직 돌려보지 못했으니, 커넥터 대화상자에 오류가 나오면 게이트웨이 로그
줄과 함께 이슈를 남겨 주세요.

## 3. 분석 대상 넣기

컨테이너 안의 `/targets`가 호스트의 `remote/targets/`에 마운트돼 있습니다. 분석할 파일을
거기 복사하고 Claude에게 `/targets/파일명` 으로 열어 달라고 하면 됩니다.

## 보안 — 꼭 읽으세요

- 이 엔드포인트는 **임의 바이너리를 열고, gdb/Playwright/프로세스 캡처까지 하는 서버**입니다.
  URL을 아는 사람은 누구나 쓸 수 있으므로 `REA_PATH_SECRET`은 길고 무작위여야 하며 절대
  공유하지 마세요. (claude.ai 커넥터 UI에는 커스텀 헤더 입력이 없어, 경로 비밀이 가장 단순한
  방식입니다.)
- 데모 이상으로 띄워 둘 거면 경로 비밀 대신 OAuth 게이트웨이(`docker-compose.oauth.yml`, 2b절)를
  쓰세요.
- 퀵 터널은 재시작마다 호스트명이 바뀝니다. 고정 호스트명은 named tunnel을 쓰세요.
- 자기 서버에 둘 때는 `-v ./targets:/targets` 외에 다른 볼륨을 주지 마세요. 컨테이너는
  비루트(`rea`) 사용자로 돕니다.

## 검증 상태

- `scripts/install-engines.sh`(Ghidra 12.1.4 SHA-256 검증, jadx, apt 도구)와 REA 6.7.0 +
  Ghidra 디컴파일, supergateway stdio→Streamable HTTP 브리지는 Ubuntu 24.04 컨테이너에서
  실제로 실행해 확인했습니다.
- OAuth 게이트웨이는 실제 REA 브리지를 상대로 실행: 전체 PKCE 흐름과 프록시를 통한 인증된
  `initialize`가 REA 6.7.0을 반환했습니다.
- `entrypoint.sh`는 설치된 REA가 네이티브 `rea mcp --http`를 지원하면(REA `main`, npm 6.7.0에는
  아직 없음) 그걸 쓰고 아니면 supergateway 브리지로 폴백합니다 — 감지 로직은 selftest가 점검.
- `docker build` 자체와 Cloudflare 터널은 이 환경에 Docker가 없어 실행하지 못했습니다.
  첫 실행에서 문제가 나면 `docker compose logs rea`를 확인하세요.
