#!/usr/bin/env python3
"""Generates the README diagrams (light + dark) as dependency-free SVG.

    python3 docs/img/generate.py

Every figure is drawn per language (en, ko, zh, ja) and per theme (light, dark) from one string table
and one palette table; the READMEs pick the variant with <picture> + prefers-color-scheme.
Edit the text here, not in the SVGs.
"""
from pathlib import Path

HERE = Path(__file__).parent
FONT = "Inter, ui-sans-serif, -apple-system, 'Segoe UI', Roboto, 'Apple SD Gothic Neo', 'Malgun Gothic', 'PingFang SC', 'Hiragino Sans', 'Microsoft YaHei', 'Yu Gothic UI', 'Noto Sans KR', 'Noto Sans SC', 'Noto Sans JP', 'Noto Sans CJK SC', Helvetica, Arial, sans-serif"
MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"

PALETTES = {
    "dark": dict(bg0="#0e0e13", bg1="#171326", card="#1a1a23", card2="#20202b", line="#2d2d3a", fg="#ededf3",
                 muted="#9a9aab", accent="#a78bfa", accent2="#7c5cf0", good="#4ade80", warn="#fbbf24", bad="#f87171",
                 term="#0b0b10", termline="#26262f", pill="#241f3a"),
    "light": dict(bg0="#ffffff", bg1="#f4f1ff", card="#ffffff", card2="#f7f6fb", line="#e3e1ee", fg="#17171f",
                  muted="#6b6b7c", accent="#6d4fe0", accent2="#5b3fd1", good="#15803d", warn="#b45309", bad="#dc2626",
                  term="#1b1b24", termline="#30303c", pill="#ede8ff"),
}


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def tw(s, size):
    """Rough text width: CJK glyphs are ~1 em, Latin ~0.58 em."""
    return sum(size * (1.0 if ord(ch) > 0x2E7F else 0.58) for ch in s)


class Canvas:
    def __init__(self, w, h, p, label):
        self.w, self.h, self.p = w, h, p
        self.out = [
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-label="{esc(label)}">',
            '<defs>',
            f'<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{p["bg0"]}"/><stop offset="1" stop-color="{p["bg1"]}"/></linearGradient>',
            f'<linearGradient id="acc" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="{p["accent"]}"/><stop offset="1" stop-color="{p["accent2"]}"/></linearGradient>',
            f'<marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0.5 L7,4 L0,7.5 z" fill="{p["muted"]}"/></marker>',
            f'<marker id="arrA" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0.5 L7,4 L0,7.5 z" fill="{p["accent"]}"/></marker>',
            f'<marker id="arrG" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0.5 L7,4 L0,7.5 z" fill="{p["good"]}"/></marker>',
            '</defs>',
            f'<rect width="{w}" height="{h}" rx="20" fill="url(#bg)"/>',
        ]

    def text(self, x, y, s, size=13, fill=None, weight="normal", anchor="start", mono=False, opacity=1):
        fill = fill or self.p["fg"]
        fam = MONO if mono else FONT
        self.out.append(f'<text x="{x}" y="{y}" font-family="{fam}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}" opacity="{opacity}">{esc(s)}</text>')

    def rect(self, x, y, w, h, fill=None, stroke=None, r=12, sw=1.2, dash=None, opacity=1):
        fill = fill or self.p["card"]
        stroke = stroke or self.p["line"]
        d = f' stroke-dasharray="{dash}"' if dash else ''
        self.out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d} opacity="{opacity}"/>')

    def card(self, x, y, w, h, title, sub=None, bar=None, tsize=14):
        self.rect(x, y, w, h)
        if bar:
            self.out.append(f'<rect x="{x}" y="{y+10}" width="4" height="{h-20}" rx="2" fill="{bar}"/>')
        tx = x + 18
        if sub:
            self.text(tx, y + h / 2 - 3, title, tsize, weight="600")
            self.text(tx, y + h / 2 + 15, sub, 11.5, self.p["muted"])
        else:
            self.text(tx, y + h / 2 + 5, title, tsize, weight="600")

    def arrow(self, pts, label=None, color=None, dashed=False, marker="arr", lpos=0.5, lsize=11, loff=-6):
        color = color or self.p["muted"]
        d = ' stroke-dasharray="5 4"' if dashed else ''
        path = "M" + " L".join(f"{x},{y}" for x, y in pts)
        self.out.append(f'<path d="{path}" fill="none" stroke="{color}" stroke-width="1.6"{d} marker-end="url(#{marker})"/>')
        if label:
            # label at the midpoint of the longest segment
            best = max(zip(pts, pts[1:]), key=lambda s: abs(s[1][0] - s[0][0]) + abs(s[1][1] - s[0][1]))
            (x1, y1), (x2, y2) = best
            lx, ly = x1 + (x2 - x1) * lpos, y1 + (y2 - y1) * lpos
            w = tw(label, lsize) + 10
            self.out.append(f'<rect x="{lx - w/2}" y="{ly + loff - lsize}" width="{w}" height="{lsize + 7}" rx="5" fill="{self.p["card"]}" opacity="0.95"/>')
            self.text(lx, ly + loff + 1, label, lsize, color, anchor="middle")

    def pill(self, x, y, s, color=None, fill=None, size=12):
        color = color or self.p["accent"]
        fill = fill or self.p["pill"]
        w = tw(s, size) + 22
        self.out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{size + 12}" rx="{(size + 12) / 2}" fill="{fill}"/>')
        self.text(x + w / 2, y + size + 2, s, size, color, "600", "middle")
        return w

    def circle_num(self, x, y, n, color):
        self.out.append(f'<circle cx="{x}" cy="{y}" r="13" fill="{color}" opacity="0.18"/>')
        self.out.append(f'<circle cx="{x}" cy="{y}" r="13" fill="none" stroke="{color}" stroke-width="1.5"/>')
        self.text(x, y + 5, str(n), 13, color, "700", "middle")

    def save(self, name):
        self.out.append("</svg>")
        (HERE / name).write_text("\n".join(self.out), encoding="utf-8")


# ------------------------------------------------------------------- string tables
T = {
    "en": dict(
        hero_label="REA for Claude: REA's 207 reverse-engineering tools on Windows, macOS, Linux and claude.ai cloud, with engines that install themselves and reverse-engineering prompts routed to REA automatically",
        tagline="Reverse Engineer Anything — from any Claude surface, with zero setup.",
        pills=["Windows", "macOS", "Linux", "claude.ai cloud", "Claude Desktop"],
        tiles=[("207", "REA tools, unmodified"), ("0", "manual setup steps"), ("26 s", "engine install · Windows 11"), ("3", "surfaces + Docker")],
        hero_lines=["The engines (JDK 21 · Ghidra 12.1.4 · jadx) install themselves on first use.",
                    "Reverse-engineering requests are routed to REA automatically — EN · KO · ZH · JA.",
                    "Findings become HTML / Markdown / JSON reports, diffable across builds and machines."],
        term=[("$ claude plugin install rea@rea-for-claude", "#e6e6ef"), ("✓ Installed rea 1.0.0", "#4ade80"), ("", ""),
              ("$ claude", "#e6e6ef"), ("REA: installing JDK 21 + Ghidra + jadx for windows/x64", "#a78bfa"),
              ("     in the background (~810 MB, usually 1–5 min)", "#a78bfa"), ("", ""),
              ("> what does app.apk actually do?", "#e6e6ef"), ("[REA] reverse engineering → Android APK playbook (jadx)", "#fbbf24"),
              ("● open_binary → analyze → classes · strings · manifest", "#9a9aab"), ("● /rea:report → app-2026-10-21.html", "#9a9aab")],
        cmp_label="Upstream REA needs five manual steps on one machine; REA for Claude is one plugin install, after which the engines install themselves and the same tools run in Claude Code, Claude Desktop and claude.ai cloud, with reports and self-repair",
        cmp_title="Two ways to run the same 207 tools",
        cmp_sub="REA for Claude runs the unmodified rea-agents package — it changes how you get to it, not what it does.",
        left_h="UPSTREAM REA", left_s="a local MCP server; you bring the engines",
        right_h="REA FOR CLAUDE", right_s="plugin: engines included, every surface, auto-routed",
        steps=[("Install a JDK 21 by hand", "set JAVA_HOME"), ("Download Ghidra, unzip, set GHIDRA_INSTALL_DIR", "570 MB · no checksum · no resume"),
               ("Download jadx-headless-mcp, set REA_JADX_MCP_JAR", "one more path to get right"), ("npx rea-agents setup", "registers one client on this machine"),
               ("Say “use REA” in every prompt", "or Claude reaches for strings / objdump")],
        left_foot="One machine · one client · chat output only · Windows Ghidra “experimental”",
        r_install=("claude plugin install rea@rea-for-claude", "that is the whole setup"), first="first session",
        r_engines=("Engines install themselves in the background", "JDK 21 if needed · Ghidra 12.1.4 (SHA-256) · jadx · apktool / radare2 optional"),
        surfaces=[("Claude Code", "any OS · auto-routed", "plugin hook"), ("Claude Desktop", "phone via linked session", ".mcpb"), ("claude.ai cloud", "no PC needed", "attach repo")],
        r_report=("/rea:analyze → evidence JSON → /rea:report", "HTML (6 themes) · Markdown · JSON · bundles · --diff of two builds"),
        r_doctor="/rea:doctor self-repair · resumable & offline installs · --upgrade",
        verified="Verified: 207 live tools on win32 · full engine install 26 s on Windows 11 · CI on 3 OSes",
        arch_label="Architecture: a SessionStart hook starts the installer when engines are missing, the installer writes ~/.rea-engines, the launcher reads it and spawns the unmodified REA MCP server, a UserPromptSubmit router adds context for reverse-engineering prompts, and make-report turns evidence JSON into reports",
        arch_title="How it fits together",
        arch_sub="Three small Node scripts around the unmodified REA server. Nothing patches REA; the plugin talks to it like any MCP client.",
        lanes=["CLAUDE SESSION  ·  Code · Desktop · cloud", "PLUGIN RUNTIME", "~/.rea-engines  ·  one per machine"],
        hook=("SessionStart hook", "ensure-engines.cjs · 0.2 s"), router=("UserPromptSubmit router", "rea-router.cjs · 40 ms · EN / KO / ZH / JA"),
        claude=("Claude", "skills · playbooks · /rea:* commands"), launcher=("launch-rea.cjs", "env › config › auto-discovery · JAVA_HOME · PATH"),
        server=("REA MCP server", "rea-agents 6.7.0 · 207 tools · unmodified"), report=("make-report.mjs", "HTML / MD / JSON · themes · bundles · --diff"),
        installer=("install-engines.cjs", "per-OS/CPU · SHA-256 · resume · offline · --upgrade"),
        rows=[("jdk-21/", "only if no JDK 21+ is found on the machine"), ("ghidra_12.1.4_PUBLIC/", "native decompiler for this platform"),
              ("jadx-headless-mcp-0.7.1-all.jar", "Android APK / DEX"), ("bin/apktool · radare2/", "optional · put first on PATH"),
              ("archives/ · engines.json · install.log", "offline input · state · progress")],
        a_starts="starts it when engines are missing", a_reads="reads", a_spawns="spawns", a_ctx="adds “use REA + playbook” context",
        a_mcp="MCP tool calls", a_ev="evidence JSON", a_runs="runs Ghidra / jadx", a_report="report file",
        legend="dashed = starts the installer / reads the engines directory · solid = runtime calls",
    ),
    "ko": dict(
        hero_label="REA for Claude: Windows·macOS·Linux·claude.ai 클라우드에서 REA 툴 207개, 엔진 자동 설치, 리버스 엔지니어링 프롬프트 자동 라우팅",
        tagline="Reverse Engineer Anything — Claude가 있는 모든 곳에서, 설정 없이.",
        pills=["Windows", "macOS", "Linux", "claude.ai 클라우드", "Claude Desktop"],
        tiles=[("207", "REA 툴, 원본 그대로"), ("0", "수동 설정 단계"), ("26초", "엔진 설치 · Windows 11"), ("3", "실행 환경 + Docker")],
        hero_lines=["엔진(JDK 21 · Ghidra 12.1.4 · jadx)은 첫 사용 시 알아서 설치됩니다.",
                    "리버스 엔지니어링 요청은 자동으로 REA로 라우팅됩니다 — 한국어·영어·중국어·일본어.",
                    "결과는 HTML / Markdown / JSON 리포트가 되고, 빌드·머신 간 diff가 됩니다."],
        term=[("$ claude plugin install rea@rea-for-claude", "#e6e6ef"), ("✓ Installed rea 1.0.0", "#4ade80"), ("", ""),
              ("$ claude", "#e6e6ef"), ("REA: installing JDK 21 + Ghidra + jadx for windows/x64", "#a78bfa"),
              ("     in the background (~810 MB, usually 1–5 min)", "#a78bfa"), ("", ""),
              ("> 이 app.apk 뭐 하는 앱이야?", "#e6e6ef"), ("[REA] 리버스 엔지니어링 → Android APK 플레이북 (jadx)", "#fbbf24"),
              ("● open_binary → analyze → classes · strings · manifest", "#9a9aab"), ("● /rea:report → app-2026-10-21.html", "#9a9aab")],
        cmp_label="업스트림 REA는 한 머신에서 수동 5단계가 필요하고, REA for Claude는 플러그인 설치 한 줄 뒤 엔진이 알아서 설치되어 같은 툴이 Claude Code·Claude Desktop·claude.ai 클라우드에서 리포트·자가 복구와 함께 동작합니다",
        cmp_title="같은 207개 툴을 쓰는 두 가지 길",
        cmp_sub="REA for Claude는 원본 rea-agents 패키지를 그대로 실행합니다 — 하는 일이 아니라 거기까지 가는 길을 바꿉니다.",
        left_h="업스트림 REA", left_s="로컬 MCP 서버 · 엔진은 직접 준비",
        right_h="REA FOR CLAUDE", right_s="플러그인 · 엔진 포함 · 모든 환경 · 자동 라우팅",
        steps=[("JDK 21 직접 설치", "JAVA_HOME 설정"), ("Ghidra 다운로드·압축 해제, GHIDRA_INSTALL_DIR 설정", "570 MB · 체크섬 없음 · 이어받기 없음"),
               ("jadx-headless-mcp 다운로드, REA_JADX_MCP_JAR 설정", "경로 하나 더 맞춰야 함"), ("npx rea-agents setup", "이 머신의 클라이언트 하나에 등록"),
               ("프롬프트마다 “REA 써” 라고 말하기", "안 그러면 Claude가 strings / objdump로 대충 봄")],
        left_foot="머신 하나 · 클라이언트 하나 · 채팅 출력만 · Windows Ghidra는 “experimental”",
        r_install=("claude plugin install rea@rea-for-claude", "설정은 이게 전부"), first="첫 세션",
        r_engines=("엔진이 백그라운드로 알아서 설치", "JDK 21(필요 시) · Ghidra 12.1.4 (SHA-256) · jadx · apktool / radare2 선택"),
        surfaces=[("Claude Code", "모든 OS · 자동 라우팅", "플러그인 훅"), ("Claude Desktop", "연결 세션으로 폰에서도", ".mcpb"), ("claude.ai 클라우드", "PC 없이", "저장소 첨부")],
        r_report=("/rea:analyze → evidence JSON → /rea:report", "HTML (테마 6종) · Markdown · JSON · 번들 · 두 빌드 --diff"),
        r_doctor="/rea:doctor 자가 복구 · 이어받기·오프라인 설치 · --upgrade",
        verified="검증: win32에서 라이브 툴 207개 · Windows 11 전체 엔진 설치 26초 · 3개 OS CI",
        arch_label="아키텍처: SessionStart 훅이 엔진이 없으면 설치기를 띄우고, 설치기가 ~/.rea-engines를 쓰고, 런처가 그것을 읽어 원본 REA MCP 서버를 띄우며, UserPromptSubmit 라우터가 리버스 엔지니어링 프롬프트에 컨텍스트를 더하고, make-report가 evidence JSON을 리포트로 만듭니다",
        arch_title="구성 요소가 맞물리는 방식",
        arch_sub="원본 REA 서버를 감싸는 작은 Node 스크립트 셋. REA를 패치하지 않고, 여느 MCP 클라이언트처럼 대화합니다.",
        lanes=["CLAUDE 세션  ·  Code · Desktop · 클라우드", "플러그인 런타임", "~/.rea-engines  ·  머신당 하나"],
        hook=("SessionStart 훅", "ensure-engines.cjs · 0.2초"), router=("UserPromptSubmit 라우터", "rea-router.cjs · 40ms · 한/영/중/일"),
        claude=("Claude", "스킬 · 플레이북 · /rea:* 커맨드"), launcher=("launch-rea.cjs", "env › 설정 › 자동 탐색 · JAVA_HOME · PATH"),
        server=("REA MCP 서버", "rea-agents 6.7.0 · 툴 207개 · 원본 그대로"), report=("make-report.mjs", "HTML / MD / JSON · 테마 · 번들 · --diff"),
        installer=("install-engines.cjs", "OS/CPU별 · SHA-256 · 이어받기 · 오프라인 · --upgrade"),
        rows=[("jdk-21/", "머신에 JDK 21+가 없을 때만"), ("ghidra_12.1.4_PUBLIC/", "이 플랫폼용 네이티브 디컴파일러"),
              ("jadx-headless-mcp-0.7.1-all.jar", "Android APK / DEX"), ("bin/apktool · radare2/", "선택 · PATH 맨 앞에"),
              ("archives/ · engines.json · install.log", "오프라인 입력 · 상태 · 진행 로그")],
        a_starts="엔진이 없으면 설치기 시작", a_reads="읽기", a_spawns="실행", a_ctx="“REA + 플레이북 사용” 컨텍스트 추가",
        a_mcp="MCP 툴 호출", a_ev="evidence JSON", a_runs="Ghidra / jadx 실행", a_report="리포트 파일",
        legend="점선 = 설치기 시작 / 엔진 디렉터리 읽기 · 실선 = 런타임 호출",
    ),
    "zh": dict(
        hero_label="REA for Claude：在 Windows、macOS、Linux 和 claude.ai 云端使用 REA 的 207 个逆向工程工具，引擎自动安装，逆向工程请求自动路由到 REA",
        tagline="Reverse Engineer Anything — 在任何 Claude 界面，零配置。",
        pills=["Windows", "macOS", "Linux", "claude.ai 云端", "Claude Desktop"],
        tiles=[("207", "REA 工具，原样运行"), ("0", "手动配置步骤"), ("26 秒", "引擎安装 · Windows 11"), ("3", "运行环境 + Docker")],
        hero_lines=["引擎（JDK 21 · Ghidra 12.1.4 · jadx）在首次使用时自动安装。",
                    "逆向工程请求会自动路由到 REA — 支持中文、英文、韩文、日文。",
                    "分析结果生成 HTML / Markdown / JSON 报告，可跨构建、跨机器比对。"],
        term=[("$ claude plugin install rea@rea-for-claude", "#e6e6ef"), ("✓ Installed rea 1.0.0", "#4ade80"), ("", ""),
              ("$ claude", "#e6e6ef"), ("REA: installing JDK 21 + Ghidra + jadx for windows/x64", "#a78bfa"),
              ("     in the background (~810 MB, usually 1–5 min)", "#a78bfa"), ("", ""),
              ("> 这个 app.apk 到底是做什么的？", "#e6e6ef"), ("[REA] 逆向工程 → Android APK 流程 (jadx)", "#fbbf24"),
              ("● open_binary → analyze → classes · strings · manifest", "#9a9aab"), ("● /rea:report → app-2026-10-21.html", "#9a9aab")],
        cmp_label="上游 REA 需要在一台机器上手动完成五步；REA for Claude 只需安装一个插件，之后引擎自动安装，同样的工具可在 Claude Code、Claude Desktop 和 claude.ai 云端运行，并带有报告和自修复",
        cmp_title="运行同样 207 个工具的两条路",
        cmp_sub="REA for Claude 原样运行 rea-agents 包 — 改变的是使用方式，而不是它做的事。",
        left_h="上游 REA", left_s="本地 MCP 服务器 · 引擎自备",
        right_h="REA FOR CLAUDE", right_s="插件 · 内置引擎 · 所有环境 · 自动路由",
        steps=[("手动安装 JDK 21", "设置 JAVA_HOME"), ("下载并解压 Ghidra，设置 GHIDRA_INSTALL_DIR", "570 MB · 无校验 · 不能续传"),
               ("下载 jadx-headless-mcp，设置 REA_JADX_MCP_JAR", "又一个要填对的路径"), ("npx rea-agents setup", "只注册这台机器上的一个客户端"),
               ("每次提示都要说“用 REA”", "否则 Claude 会去用 strings / objdump")],
        left_foot="一台机器 · 一个客户端 · 只有聊天输出 · Windows Ghidra 为“实验性”",
        r_install=("claude plugin install rea@rea-for-claude", "这就是全部配置"), first="首次会话",
        r_engines=("引擎在后台自动安装", "按需 JDK 21 · Ghidra 12.1.4 (SHA-256) · jadx · 可选 apktool / radare2"),
        surfaces=[("Claude Code", "任意系统 · 自动路由", "插件钩子"), ("Claude Desktop", "手机上也能继续", ".mcpb"), ("claude.ai 云端", "无需电脑", "附加仓库")],
        r_report=("/rea:analyze → evidence JSON → /rea:report", "HTML（6 种主题）· Markdown · JSON · 证据包 · 两个构建的 --diff"),
        r_doctor="/rea:doctor 自修复 · 可续传与离线安装 · --upgrade",
        verified="已验证：win32 上 207 个在线工具 · Windows 11 完整引擎安装 26 秒 · 三系统 CI",
        arch_label="架构：SessionStart 钩子在引擎缺失时启动安装器，安装器写入 ~/.rea-engines，启动器读取它并拉起原版 REA MCP 服务器，UserPromptSubmit 路由器为逆向工程提示添加上下文，make-report 把 evidence JSON 变成报告",
        arch_title="各部分如何协作",
        arch_sub="三个小型 Node 脚本包裹原版 REA 服务器。不修改 REA；插件像任何 MCP 客户端一样与它对话。",
        lanes=["CLAUDE 会话  ·  Code · Desktop · 云端", "插件运行时", "~/.rea-engines  ·  每台机器一份"],
        hook=("SessionStart 钩子", "ensure-engines.cjs · 0.2 秒"), router=("UserPromptSubmit 路由器", "rea-router.cjs · 40 ms · 多语言"),
        claude=("Claude", "技能 · 流程手册 · /rea:* 命令"), launcher=("launch-rea.cjs", "环境变量 › 配置 › 自动发现 · JAVA_HOME · PATH"),
        server=("REA MCP 服务器", "rea-agents 6.7.0 · 207 个工具 · 原版"), report=("make-report.mjs", "HTML / MD / JSON · 主题 · 证据包 · --diff"),
        installer=("install-engines.cjs", "按系统/CPU · SHA-256 · 续传 · 离线 · --upgrade"),
        rows=[("jdk-21/", "仅当机器上没有 JDK 21+ 时"), ("ghidra_12.1.4_PUBLIC/", "本平台的原生反编译器"),
              ("jadx-headless-mcp-0.7.1-all.jar", "Android APK / DEX"), ("bin/apktool · radare2/", "可选 · 置于 PATH 最前"),
              ("archives/ · engines.json · install.log", "离线输入 · 状态 · 进度")],
        a_starts="引擎缺失时启动安装器", a_reads="读取", a_spawns="拉起", a_ctx="添加“使用 REA + 流程手册”上下文",
        a_mcp="MCP 工具调用", a_ev="evidence JSON", a_runs="运行 Ghidra / jadx", a_report="报告文件",
        legend="虚线 = 启动安装器 / 读取引擎目录 · 实线 = 运行时调用",
    ),
    "ja": dict(
        hero_label="REA for Claude：Windows・macOS・Linux・claude.ai クラウドで REA の 207 個のリバースエンジニアリングツールを利用。エンジンは自動インストール、リバースエンジニアリングの依頼は REA へ自動ルーティング",
        tagline="Reverse Engineer Anything — Claude のあらゆる場所で、セットアップ不要。",
        pills=["Windows", "macOS", "Linux", "claude.ai クラウド", "Claude Desktop"],
        tiles=[("207", "REA ツール、無改変"), ("0", "手動セットアップ手順"), ("26 秒", "エンジン導入 · Windows 11"), ("3", "実行環境 + Docker")],
        hero_lines=["エンジン（JDK 21 · Ghidra 12.1.4 · jadx）は初回利用時に自動インストールされます。",
                    "リバースエンジニアリングの依頼は自動的に REA へ — 日本語・英語・韓国語・中国語に対応。",
                    "結果は HTML / Markdown / JSON レポートになり、ビルド間・マシン間で diff できます。"],
        term=[("$ claude plugin install rea@rea-for-claude", "#e6e6ef"), ("✓ Installed rea 1.0.0", "#4ade80"), ("", ""),
              ("$ claude", "#e6e6ef"), ("REA: installing JDK 21 + Ghidra + jadx for windows/x64", "#a78bfa"),
              ("     in the background (~810 MB, usually 1–5 min)", "#a78bfa"), ("", ""),
              ("> この app.apk は何をするアプリ？", "#e6e6ef"), ("[REA] リバースエンジニアリング → Android APK プレイブック (jadx)", "#fbbf24"),
              ("● open_binary → analyze → classes · strings · manifest", "#9a9aab"), ("● /rea:report → app-2026-10-21.html", "#9a9aab")],
        cmp_label="上流 REA は 1 台のマシンで手動 5 ステップが必要。REA for Claude はプラグインを 1 つ入れるだけで、エンジンが自動インストールされ、同じツールが Claude Code・Claude Desktop・claude.ai クラウドで動き、レポートと自己修復も備える",
        cmp_title="同じ 207 ツールへの 2 つの道",
        cmp_sub="REA for Claude は rea-agents パッケージを無改変で実行します — 変えるのは使い方であって、中身ではありません。",
        left_h="上流 REA", left_s="ローカル MCP サーバー · エンジンは自前で用意",
        right_h="REA FOR CLAUDE", right_s="プラグイン · エンジン同梱 · 全環境 · 自動ルーティング",
        steps=[("JDK 21 を手動インストール", "JAVA_HOME を設定"), ("Ghidra をダウンロード・展開し GHIDRA_INSTALL_DIR を設定", "570 MB · 検証なし · 再開不可"),
               ("jadx-headless-mcp をダウンロードし REA_JADX_MCP_JAR を設定", "もう 1 つ正しく指定すべきパス"), ("npx rea-agents setup", "このマシンのクライアント 1 つに登録"),
               ("毎回「REA を使って」と書く", "書かないと Claude は strings / objdump で済ませる")],
        left_foot="1 台 · 1 クライアント · チャット出力のみ · Windows Ghidra は「実験的」",
        r_install=("claude plugin install rea@rea-for-claude", "セットアップはこれだけ"), first="初回セッション",
        r_engines=("エンジンがバックグラウンドで自動インストール", "必要なら JDK 21 · Ghidra 12.1.4 (SHA-256) · jadx · 任意で apktool / radare2"),
        surfaces=[("Claude Code", "全 OS · 自動ルーティング", "プラグインフック"), ("Claude Desktop", "スマホからも利用可", ".mcpb"), ("claude.ai クラウド", "PC 不要", "リポジトリ添付")],
        r_report=("/rea:analyze → evidence JSON → /rea:report", "HTML（6 テーマ）· Markdown · JSON · バンドル · 2 ビルドの --diff"),
        r_doctor="/rea:doctor 自己修復 · 再開・オフライン導入 · --upgrade",
        verified="検証済み：win32 でライブツール 207 個 · Windows 11 でエンジン一式 26 秒 · 3 OS の CI",
        arch_label="アーキテクチャ：SessionStart フックがエンジン不在時にインストーラを起動し、インストーラが ~/.rea-engines に書き込み、ランチャーがそれを読んで無改変の REA MCP サーバーを起動、UserPromptSubmit ルーターがリバースエンジニアリングのプロンプトに文脈を付与し、make-report が evidence JSON をレポートにする",
        arch_title="構成要素のつながり",
        arch_sub="無改変の REA サーバーを 3 つの小さな Node スクリプトが包みます。REA にパッチは当てず、普通の MCP クライアントとして話します。",
        lanes=["CLAUDE セッション  ·  Code · Desktop · クラウド", "プラグインランタイム", "~/.rea-engines  ·  マシンごとに 1 つ"],
        hook=("SessionStart フック", "ensure-engines.cjs · 0.2 秒"), router=("UserPromptSubmit ルーター", "rea-router.cjs · 40 ms · 多言語"),
        claude=("Claude", "スキル · プレイブック · /rea:* コマンド"), launcher=("launch-rea.cjs", "環境変数 › 設定 › 自動検出 · JAVA_HOME · PATH"),
        server=("REA MCP サーバー", "rea-agents 6.7.0 · 207 ツール · 無改変"), report=("make-report.mjs", "HTML / MD / JSON · テーマ · バンドル · --diff"),
        installer=("install-engines.cjs", "OS/CPU 別 · SHA-256 · 再開 · オフライン · --upgrade"),
        rows=[("jdk-21/", "マシンに JDK 21+ が無いときだけ"), ("ghidra_12.1.4_PUBLIC/", "このプラットフォーム用ネイティブ逆コンパイラ"),
              ("jadx-headless-mcp-0.7.1-all.jar", "Android APK / DEX"), ("bin/apktool · radare2/", "任意 · PATH の先頭に"),
              ("archives/ · engines.json · install.log", "オフライン入力 · 状態 · 進捗")],
        a_starts="エンジン不在ならインストーラを起動", a_reads="読み取り", a_spawns="起動", a_ctx="「REA + プレイブックを使う」文脈を付与",
        a_mcp="MCP ツール呼び出し", a_ev="evidence JSON", a_runs="Ghidra / jadx を実行", a_report="レポートファイル",
        legend="破線 = インストーラ起動 / エンジンディレクトリ読み取り · 実線 = 実行時の呼び出し",
    ),
}


# --------------------------------------------------------------------------- hero
def hero(theme, lang):
    p, t = PALETTES[theme], T[lang]
    c = Canvas(1280, 420, p, t["hero_label"])
    # left copy
    c.text(56, 92, "REA for Claude", 40, p["fg"], "800")
    c.text(56, 124, t["tagline"], 16, p["muted"])
    x = 56
    for s in t["pills"]:
        x += c.pill(x, 146, s) + 8
    # stat tiles
    for i, (big, small) in enumerate(t["tiles"]):
        tx = 56 + i * 150
        c.rect(tx, 206, 138, 76, p["card"], p["line"], r=12)
        c.text(tx + 16, 240, big, 24, p["accent"], "800")
        c.text(tx + 16, 262, small, 11, p["muted"])
    for i, line in enumerate(t["hero_lines"]):
        c.text(56, 322 + i * 20, line, 13, p["muted"])
    # terminal mock
    tx, ty, tw, th = 700, 52, 524, 316
    c.out.append(f'<rect x="{tx}" y="{ty}" width="{tw}" height="{th}" rx="14" fill="{p["term"]}" stroke="{p["termline"]}"/>')
    c.out.append(f'<rect x="{tx}" y="{ty}" width="{tw}" height="34" rx="14" fill="{p["termline"]}"/><rect x="{tx}" y="{ty+20}" width="{tw}" height="14" fill="{p["termline"]}"/>')
    for i, col in enumerate(["#ff5f57", "#febc2e", "#28c840"]):
        c.out.append(f'<circle cx="{tx+22+i*20}" cy="{ty+17}" r="6" fill="{col}"/>')
    c.text(tx + tw / 2, ty + 22, "claude", 12, "#c9c9d6", anchor="middle", mono=True)
    for i, (s, col) in enumerate(t["term"]):
        if s:
            c.text(tx + 20, ty + 60 + i * 22, s, 12.5, col, mono=True)
    c.save(f"hero-{lang}-{theme}.svg")


# --------------------------------------------------------------------- comparison
def comparison(theme, lang):
    p, t = PALETTES[theme], T[lang]
    c = Canvas(1280, 600, p, t["cmp_label"])
    c.text(56, 54, t["cmp_title"], 22, p["fg"], "800")
    c.text(56, 78, t["cmp_sub"], 13, p["muted"])
    # column headers
    c.text(56, 126, t["left_h"], 12, p["muted"], "700")
    c.text(56, 146, t["left_s"], 12, p["muted"])
    c.text(676, 126, t["right_h"], 12, p["accent"], "700")
    c.text(676, 146, t["right_s"], 12, p["muted"])
    c.out.append(f'<line x1="640" y1="112" x2="640" y2="560" stroke="{p["line"]}" stroke-dasharray="3 6"/>')
    # left steps
    colors = [p["warn"], p["warn"], p["warn"], p["muted"], p["bad"]]
    for i, ((title, sub), col) in enumerate(zip(t["steps"], colors)):
        y = 166 + i * 70
        c.circle_num(76, y + 28, i + 1, col)
        c.card(100, y, 500, 56, title, sub, bar=col)
        if i < len(t["steps"]) - 1:
            c.arrow([(76, y + 43), (76, y + 68)], color=col)
    c.text(56, 540, t["left_foot"], 12, p["muted"])
    # right flow
    c.card(676, 166, 548, 56, t["r_install"][0], t["r_install"][1], bar=p["accent"])
    c.arrow([(950, 222), (950, 244)], t["first"], p["accent"], marker="arrA", lsize=10, loff=4)
    c.card(676, 250, 548, 56, t["r_engines"][0], t["r_engines"][1], bar=p["good"])
    # fan-out
    xs = [676, 862, 1048]
    labels = t["surfaces"]
    # bus line, then one labelled drop per surface
    c.out.append(f'<path d="M950,306 L950,320 M764,320 L1136,320" fill="none" stroke="{p["good"]}" stroke-width="1.6"/>')
    for x, (title, s_, how) in zip(xs, labels):
        c.arrow([(x + 88, 320), (x + 88, 352)], how, p["good"], marker="arrG", lsize=10, loff=4, lpos=0.5)
        c.card(x, 356, 176, 56, title, s_, tsize=13)
    for x in xs:
        c.arrow([(x + 88, 412), (x + 88, 432)], color=p["muted"])
    c.card(676, 436, 548, 56, t["r_report"][0], t["r_report"][1])
    c.arrow([(950, 492), (950, 510)], color=p["muted"])
    c.card(676, 514, 548, 44, t["r_doctor"], tsize=13)
    c.text(676, 582, t["verified"], 12, p["good"])
    c.save(f"upstream-vs-plugin-{lang}-{theme}.svg")


# ------------------------------------------------------------------- architecture
def architecture(theme, lang):
    p, t = PALETTES[theme], T[lang]
    c = Canvas(1280, 540, p, t["arch_label"])
    c.text(56, 54, t["arch_title"], 22, p["fg"], "800")
    c.text(56, 78, t["arch_sub"], 13, p["muted"])
    for (x, w), title in zip([(56, 320), (436, 360), (856, 368)], t["lanes"]):
        c.rect(x, 104, w, 396, "none", p["line"], r=14, dash="4 6")
        c.text(x + 16, 128, title, 11, p["muted"], "700")
    c.card(72, 150, 288, 58, *t["hook"], bar=p["good"])
    c.card(72, 230, 288, 58, *t["router"], bar=p["good"])
    c.card(72, 310, 288, 58, *t["claude"])
    c.card(452, 150, 328, 58, *t["launcher"], bar=p["accent"])
    c.card(452, 250, 328, 70, *t["server"])
    c.card(452, 400, 328, 58, *t["report"])
    c.card(872, 150, 336, 58, *t["installer"], bar=p["good"])
    for i, (a, b) in enumerate(t["rows"]):
        y = 230 + i * 52
        c.rect(872, y, 336, 44, p["card2"], p["line"], r=9)
        c.text(886, y + 19, a, 12, p["fg"], "600", mono=True)
        c.text(886, y + 35, b, 11, p["muted"])
    # hook -> installer (over the top)
    c.arrow([(360, 170), (404, 170), (404, 96), (1180, 96), (1180, 150)], t["a_starts"], p["good"], dashed=True, marker="arrG", lsize=10, loff=-5)
    # installer -> engines dir
    c.arrow([(1040, 208), (1040, 230)], color=p["good"], marker="arrG")
    # launcher reads engines dir
    c.arrow([(872, 179), (780, 179)], t["a_reads"], p["accent"], dashed=True, marker="arrA", lsize=10, loff=-5, lpos=0.5)
    # launcher spawns REA
    c.arrow([(616, 208), (616, 250)], t["a_spawns"], p["accent"], marker="arrA", lsize=10, loff=4)
    # router -> claude (context)
    c.arrow([(216, 288), (216, 310)], t["a_ctx"], p["good"], marker="arrG", lsize=10, loff=5)
    # claude -> REA (MCP calls)
    c.arrow([(360, 339), (420, 339), (420, 285), (452, 285)], t["a_mcp"], p["muted"], lsize=10, loff=-5)
    # REA -> evidence -> report
    c.arrow([(616, 320), (616, 400)], t["a_ev"], p["muted"], lsize=10, loff=-5)
    # REA uses engines
    c.arrow([(780, 285), (872, 285)], t["a_runs"], p["muted"], lsize=10, loff=-5)
    # report -> claude
    c.arrow([(452, 429), (420, 429), (420, 360), (360, 360)], t["a_report"], p["muted"], lsize=10, loff=-5)
    c.text(640, 524, t["legend"], 11, p["muted"], anchor="middle")
    c.save(f"architecture-{lang}-{theme}.svg")


if __name__ == "__main__":
    for lang in T:
        for theme in PALETTES:
            hero(theme, lang)
            comparison(theme, lang)
            architecture(theme, lang)
    print("ok")
