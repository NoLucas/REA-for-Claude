#!/usr/bin/env python3
"""Generates the README diagrams (light + dark) as dependency-free SVG.

    python3 docs/img/generate.py

Every figure is drawn twice from one palette table so the <picture> element in the README
can pick the variant that matches the reader's GitHub theme. Edit the text here, not in the
SVGs.
"""
from pathlib import Path

HERE = Path(__file__).parent
FONT = "Inter, ui-sans-serif, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
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
            w = len(label) * lsize * 0.58 + 10
            self.out.append(f'<rect x="{lx - w/2}" y="{ly + loff - lsize}" width="{w}" height="{lsize + 7}" rx="5" fill="{self.p["card"]}" opacity="0.95"/>')
            self.text(lx, ly + loff + 1, label, lsize, color, anchor="middle")

    def pill(self, x, y, s, color=None, fill=None, size=12):
        color = color or self.p["accent"]
        fill = fill or self.p["pill"]
        w = len(s) * size * 0.6 + 22
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


# --------------------------------------------------------------------------- hero
def hero(theme):
    p = PALETTES[theme]
    c = Canvas(1280, 420, p, "REA for Claude: REA's 207 reverse-engineering tools on Windows, macOS, Linux and claude.ai cloud, with engines that install themselves and reverse-engineering prompts routed to REA automatically")
    # left copy
    c.text(56, 92, "REA for Claude", 40, p["fg"], "800")
    c.text(56, 124, "Reverse Engineer Anything — from any Claude surface, with zero setup.", 16, p["muted"])
    x = 56
    for s in ["Windows", "macOS", "Linux", "claude.ai cloud", "Claude Desktop"]:
        x += c.pill(x, 146, s) + 8
    # stat tiles
    tiles = [("207", "REA tools, unmodified"), ("0", "manual setup steps"), ("26 s", "engine install · Windows 11"), ("3", "surfaces + Docker")]
    for i, (big, small) in enumerate(tiles):
        tx = 56 + i * 150
        c.rect(tx, 206, 138, 76, p["card"], p["line"], r=12)
        c.text(tx + 16, 240, big, 24, p["accent"], "800")
        c.text(tx + 16, 262, small, 11, p["muted"])
    c.text(56, 322, "The engines (JDK 21 · Ghidra 12.1.4 · jadx) install themselves on first use.", 13, p["muted"])
    c.text(56, 342, "Reverse-engineering requests are routed to REA automatically — in English and Korean.", 13, p["muted"])
    c.text(56, 362, "Findings become HTML / Markdown / JSON reports, diffable across builds and machines.", 13, p["muted"])
    # terminal mock
    tx, ty, tw, th = 700, 52, 524, 316
    c.out.append(f'<rect x="{tx}" y="{ty}" width="{tw}" height="{th}" rx="14" fill="{p["term"]}" stroke="{p["termline"]}"/>')
    c.out.append(f'<rect x="{tx}" y="{ty}" width="{tw}" height="34" rx="14" fill="{p["termline"]}"/><rect x="{tx}" y="{ty+20}" width="{tw}" height="14" fill="{p["termline"]}"/>')
    for i, col in enumerate(["#ff5f57", "#febc2e", "#28c840"]):
        c.out.append(f'<circle cx="{tx+22+i*20}" cy="{ty+17}" r="6" fill="{col}"/>')
    c.text(tx + tw / 2, ty + 22, "claude", 12, "#c9c9d6", anchor="middle", mono=True)
    lines = [
        ("$ claude plugin install rea@rea-for-claude", "#e6e6ef"),
        ("✓ Installed rea 1.0.0", "#4ade80"),
        ("", ""),
        ("$ claude", "#e6e6ef"),
        ("REA: installing JDK 21 + Ghidra + jadx for windows/x64", "#a78bfa"),
        ("     in the background (~810 MB, usually 1–5 min)", "#a78bfa"),
        ("", ""),
        ("> 이 app.apk 뭐 하는 앱이야?", "#e6e6ef"),
        ("[REA] reverse engineering → Android APK playbook (jadx)", "#fbbf24"),
        ("● open_binary → analyze → classes · strings · manifest", "#9a9aab"),
        ("● /rea:report → app-2026-10-21.html", "#9a9aab"),
    ]
    for i, (s, col) in enumerate(lines):
        if s:
            c.text(tx + 20, ty + 60 + i * 22, s, 12.5, col, mono=True)
    c.save(f"hero-{theme}.svg")


# --------------------------------------------------------------------- comparison
def comparison(theme):
    p = PALETTES[theme]
    c = Canvas(1280, 600, p, "Upstream REA needs five manual steps on one machine; REA for Claude is one plugin install, after which the engines install themselves and the same tools run in Claude Code, Claude Desktop and claude.ai cloud, with reports and self-repair")
    c.text(56, 54, "Two ways to run the same 207 tools", 22, p["fg"], "800")
    c.text(56, 78, "REA for Claude runs the unmodified rea-agents package — it changes how you get to it, not what it does.", 13, p["muted"])
    # column headers
    c.text(56, 126, "UPSTREAM REA", 12, p["muted"], "700")
    c.text(56, 146, "a local MCP server; you bring the engines", 12, p["muted"])
    c.text(676, 126, "REA FOR CLAUDE", 12, p["accent"], "700")
    c.text(676, 146, "plugin: engines included, every surface, auto-routed", 12, p["muted"])
    c.out.append(f'<line x1="640" y1="112" x2="640" y2="560" stroke="{p["line"]}" stroke-dasharray="3 6"/>')
    # left steps
    steps = [
        ("Install a JDK 21 by hand", "set JAVA_HOME", p["warn"]),
        ("Download Ghidra, unzip, set GHIDRA_INSTALL_DIR", "570 MB · no checksum · no resume", p["warn"]),
        ("Download jadx-headless-mcp, set REA_JADX_MCP_JAR", "one more path to get right", p["warn"]),
        ("npx rea-agents setup", "registers one client on this machine", p["muted"]),
        ("Say “use REA” in every prompt", "or Claude reaches for strings / objdump", p["bad"]),
    ]
    for i, (t, s, col) in enumerate(steps):
        y = 166 + i * 70
        c.circle_num(76, y + 28, i + 1, col)
        c.card(100, y, 500, 56, t, s, bar=col)
        if i < len(steps) - 1:
            c.arrow([(76, y + 43), (76, y + 68)], color=col)
    c.text(56, 540, "One machine · one client · chat output only · Windows Ghidra “experimental”", 12, p["muted"])
    # right flow
    c.card(676, 166, 548, 56, "claude plugin install rea@rea-for-claude", "that is the whole setup", bar=p["accent"])
    c.arrow([(950, 222), (950, 244)], "first session", p["accent"], marker="arrA", lsize=10, loff=4)
    c.card(676, 250, 548, 56, "Engines install themselves in the background", "JDK 21 if needed · Ghidra 12.1.4 (SHA-256) · jadx · apktool / radare2 optional", bar=p["good"])
    # fan-out
    xs = [676, 862, 1048]
    labels = [("Claude Code", "any OS · auto-routed", "plugin hook"), ("Claude Desktop", "phone via linked session", ".mcpb"), ("claude.ai cloud", "no PC needed", "attach repo")]
    # bus line, then one labelled drop per surface
    c.out.append(f'<path d="M950,306 L950,320 M764,320 L1136,320" fill="none" stroke="{p["good"]}" stroke-width="1.6"/>')
    for x, (t, s_, how) in zip(xs, labels):
        c.arrow([(x + 88, 320), (x + 88, 352)], how, p["good"], marker="arrG", lsize=10, loff=4, lpos=0.5)
        c.card(x, 356, 176, 56, t, s_, tsize=13)
    for x in xs:
        c.arrow([(x + 88, 412), (x + 88, 432)], color=p["muted"])
    c.card(676, 436, 548, 56, "/rea:analyze → evidence JSON → /rea:report", "HTML (6 themes) · Markdown · JSON · bundles · --diff of two builds")
    c.arrow([(950, 492), (950, 510)], color=p["muted"])
    c.card(676, 514, 548, 44, "/rea:doctor self-repair · resumable & offline installs · --upgrade", tsize=13)
    c.text(676, 582, "Verified: 207 live tools on win32 · full engine install 26 s on Windows 11 · CI on 3 OSes", 12, p["good"])
    c.save(f"upstream-vs-plugin-{theme}.svg")


# ------------------------------------------------------------------- architecture
def architecture(theme):
    p = PALETTES[theme]
    c = Canvas(1280, 540, p, "Architecture: a SessionStart hook starts the installer when engines are missing, the installer writes ~/.rea-engines, the launcher reads it and spawns the unmodified REA MCP server, a UserPromptSubmit router adds context for reverse-engineering prompts, and make-report turns evidence JSON into reports")
    c.text(56, 54, "How it fits together", 22, p["fg"], "800")
    c.text(56, 78, "Three small Node scripts around the unmodified REA server. Nothing patches REA; the plugin talks to it like any MCP client.", 13, p["muted"])
    for x, w, title in [(56, 320, "CLAUDE SESSION  ·  Code · Desktop · cloud"), (436, 360, "PLUGIN RUNTIME"), (856, 368, "~/.rea-engines  ·  one per machine")]:
        c.rect(x, 104, w, 396, "none", p["line"], r=14, dash="4 6")
        c.text(x + 16, 128, title, 11, p["muted"], "700")
    c.card(72, 150, 288, 58, "SessionStart hook", "ensure-engines.cjs · 0.2 s", bar=p["good"])
    c.card(72, 230, 288, 58, "UserPromptSubmit router", "rea-router.cjs · 40 ms · EN / KO", bar=p["good"])
    c.card(72, 310, 288, 58, "Claude", "skills · playbooks · /rea:* commands")
    c.card(452, 150, 328, 58, "launch-rea.cjs", "env › config › auto-discovery · JAVA_HOME · PATH", bar=p["accent"])
    c.card(452, 250, 328, 70, "REA MCP server", "rea-agents 6.7.0 · 207 tools · unmodified")
    c.card(452, 400, 328, 58, "make-report.mjs", "HTML / MD / JSON · themes · bundles · --diff")
    c.card(872, 150, 336, 58, "install-engines.cjs", "per-OS/CPU · SHA-256 · resume · offline · --upgrade", bar=p["good"])
    rows = [("jdk-21/", "only if no JDK 21+ is found on the machine"), ("ghidra_12.1.4_PUBLIC/", "native decompiler for this platform"),
            ("jadx-headless-mcp-0.7.1-all.jar", "Android APK / DEX"), ("bin/apktool · radare2/", "optional · put first on PATH"),
            ("archives/ · engines.json · install.log", "offline input · state · progress")]
    for i, (a, b) in enumerate(rows):
        y = 230 + i * 52
        c.rect(872, y, 336, 44, p["card2"], p["line"], r=9)
        c.text(886, y + 19, a, 12, p["fg"], "600", mono=True)
        c.text(886, y + 35, b, 11, p["muted"])
    # hook -> installer (over the top)
    c.arrow([(360, 170), (404, 170), (404, 96), (1180, 96), (1180, 150)], "starts it when engines are missing", p["good"], dashed=True, marker="arrG", lsize=10, loff=-5)
    # installer -> engines dir
    c.arrow([(1040, 208), (1040, 230)], color=p["good"], marker="arrG")
    # launcher reads engines dir
    c.arrow([(872, 179), (780, 179)], "reads", p["accent"], dashed=True, marker="arrA", lsize=10, loff=-5, lpos=0.5)
    # launcher spawns REA
    c.arrow([(616, 208), (616, 250)], "spawns", p["accent"], marker="arrA", lsize=10, loff=4)
    # router -> claude (context)
    c.arrow([(216, 288), (216, 310)], "adds “use REA + playbook” context", p["good"], marker="arrG", lsize=10, loff=5)
    # claude -> REA (MCP calls)
    c.arrow([(360, 339), (420, 339), (420, 285), (452, 285)], "MCP tool calls", p["muted"], lsize=10, loff=-5)
    # REA -> evidence -> report
    c.arrow([(616, 320), (616, 400)], "evidence JSON", p["muted"], lsize=10, loff=-5)
    # REA uses engines
    c.arrow([(780, 285), (872, 285)], "runs Ghidra / jadx", p["muted"], lsize=10, loff=-5)
    # report -> claude
    c.arrow([(452, 429), (420, 429), (420, 360), (360, 360)], "report file", p["muted"], lsize=10, loff=-5)
    c.text(640, 524, "dashed = starts the installer / reads the engines directory · solid = runtime calls", 11, p["muted"], anchor="middle")
    c.save(f"architecture-{theme}.svg")


if __name__ == "__main__":
    for theme in PALETTES:
        hero(theme)
        comparison(theme)
        architecture(theme)
    print("ok")
