---
title: 服务器自动配置代理
pubDatetime: 2026-03-19
description: 自动配置代理安装流程，自动配置代理
draft: false
featured: false
tags:
  - proxy
  - linux
  - ubuntu
---
# 快速配置服务器代理

为了能够快速完成代理服务在服务器上的配置，用AI糊了个简单的pipeline脚本，为了一键导入在脚本所在路径下增加一个新的txt文件`proxy_sources.txt`，内容如下：

```txt
# 1) 单条链接：vless:// vmess:// ss:// trojan:// hy2:// tuic://
# 2) 订阅链接：http:// 或 https://
# 3) 本地文本文件路径：文件里可放多条 vless/vmess/ss/trojan 链接
# 4) base64 订阅文本（整段）
```

在其中直接添加即可，或者在运行完安装脚本后使用`proxy add`命令直接添加，脚本如下：

```python
#!/usr/bin/env python3
import argparse
import importlib
import json
import os
import platform
import re
import shutil
import signal
import subprocess
import sys
import textwrap
import time
import urllib.request
from pathlib import Path

HOME_DIR = Path('/etc/mihomo')
PROVIDER_DIR = HOME_DIR / 'providers'
PROVIDER_FILE = PROVIDER_DIR / 'pool.txt'
CTL_ENV = HOME_DIR / 'ctl.env'
CONFIG_FILE = HOME_DIR / 'config.yaml'
PROFILE_FILE = Path('/etc/profile.d/proxy.sh')
PROXY_BIN = Path('/usr/local/bin/proxy')
MIHOMO_BIN = Path('/usr/local/bin/mihomo')
SYSTEMD_SERVICE = Path('/etc/systemd/system/mihomo.service')
LOG_FILE = HOME_DIR / 'mihomo.log'
PID_FILE = HOME_DIR / 'mihomo.pid'
SERVICE_NAME = 'mihomo'


def run(cmd, check=True, capture=False, env=None):
    p = subprocess.run(
        cmd,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.STDOUT if capture else None,
        env=env,
    )
    if check and p.returncode != 0:
        out = f"\n{p.stdout}" if capture and p.stdout else ""
        raise RuntimeError(f"command failed ({p.returncode}): {' '.join(cmd)}{out}")
    return p


class Pretty:
    def __init__(self):
        self.step = 0
        self.total = 9

    def title(self, text):
        print(f"\n{'=' * 12} {text} {'=' * 12}")

    def info(self, text):
        print(f"[INFO] {text}")

    def ok(self, text):
        print(f"[ OK ] {text}")

    def warn(self, text):
        print(f"[WARN] {text}")

    def fail(self, text):
        print(f"[FAIL] {text}")

    def next(self, text):
        self.step += 1
        print(f"\n[{self.step}/{self.total}] {text}")


P = Pretty()


def ensure_root():
    if os.geteuid() != 0:
        raise SystemExit('请用 root 或 sudo 运行: sudo python3 proxy_install.py')


TQDM = None


def try_import_tqdm():
    global TQDM
    try:
        TQDM = importlib.import_module('tqdm').tqdm
    except Exception:
        TQDM = None


def apt_install_packages():
    apt = shutil.which('apt-get')
    if not apt:
        P.warn('未检测到 apt-get，跳过依赖安装。')
        try_import_tqdm()
        return
    env = os.environ.copy()
    env['DEBIAN_FRONTEND'] = 'noninteractive'
    P.info('安装基础依赖（ca-certificates, curl, python3-tqdm）...')
    run([apt, 'update'], env=env)
    run([apt, 'install', '-y', 'ca-certificates', 'curl', 'python3-tqdm'], env=env)
    importlib.invalidate_caches()
    try_import_tqdm()
    if TQDM:
        P.ok('tqdm 已可用，后续下载会显示进度条。')
    else:
        P.warn('tqdm 未启用，继续使用普通输出。')


def has_systemd():
    return bool(shutil.which('systemctl')) and os.path.isdir('/run/systemd/system')


def stop_existing_runtime():
    if has_systemd() and SYSTEMD_SERVICE.exists():
        run(['systemctl', 'stop', SERVICE_NAME], check=False)
        run(['systemctl', 'disable', SERVICE_NAME], check=False)
    if PID_FILE.exists():
        try:
            pid = int(PID_FILE.read_text().strip())
            os.kill(pid, signal.SIGTERM)
            for _ in range(30):
                try:
                    os.kill(pid, 0)
                    time.sleep(0.2)
                except OSError:
                    break
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
        except Exception:
            pass
        try:
            PID_FILE.unlink()
        except Exception:
            pass


def cleanup_old_install():
    P.info('清理旧安装痕迹（会保留已安装的 mihomo 二进制）...')
    stop_existing_runtime()
    for path in [PROFILE_FILE, PROXY_BIN, SYSTEMD_SERVICE]:
        try:
            if path.exists() or path.is_symlink():
                path.unlink()
        except Exception:
            pass
    if HOME_DIR.exists():
        shutil.rmtree(HOME_DIR, ignore_errors=True)
    if has_systemd():
        run(['systemctl', 'daemon-reload'], check=False)
    P.ok('旧安装已清理。')


def detect_asset_suffix():
    arch = platform.machine().lower()
    if arch in ('x86_64', 'amd64'):
        return 'linux-amd64-v1'
    if arch in ('aarch64', 'arm64'):
        return 'linux-arm64'
    if arch in ('armv7l', 'armv7'):
        return 'linux-armv7'
    raise RuntimeError(f'不支持的架构: {arch}')


def is_mihomo_installed():
    if not MIHOMO_BIN.exists():
        return False
    p = run([str(MIHOMO_BIN), '-v'], check=False, capture=True)
    return p.returncode == 0


def download_file(url: str, dst: Path):
    req = urllib.request.Request(url, headers={'User-Agent': 'proxy-installer/1.0'})
    with urllib.request.urlopen(req, timeout=30) as resp:
        total = int(resp.headers.get('Content-Length', '0') or '0')
        with open(dst, 'wb') as f:
            if TQDM and total > 0:
                with TQDM(total=total, unit='B', unit_scale=True, desc='下载 mihomo') as bar:
                    while True:
                        chunk = resp.read(1024 * 128)
                        if not chunk:
                            break
                        f.write(chunk)
                        bar.update(len(chunk))
            else:
                while True:
                    chunk = resp.read(1024 * 128)
                    if not chunk:
                        break
                    f.write(chunk)


def install_mihomo_if_needed():
    if is_mihomo_installed():
        P.ok('检测到 mihomo 已安装，跳过重复下载。')
        return
    suffix = detect_asset_suffix()
    api = 'https://api.github.com/repos/MetaCubeX/mihomo/releases/latest'
    P.info('获取最新 mihomo 发行版信息...')
    req = urllib.request.Request(api, headers={'User-Agent': 'proxy-installer/1.0'})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode('utf-8', errors='ignore'))
    assets = data.get('assets', [])
    url = None
    for item in assets:
        name = item.get('name', '')
        if suffix in name and name.endswith('.gz'):
            url = item.get('browser_download_url')
            break
    if not url:
        raise RuntimeError(f'未找到适合当前架构的 mihomo 发行包: {suffix}')
    tmp_gz = Path('/tmp/mihomo.gz')
    tmp_bin = Path('/tmp/mihomo')
    P.info(f'下载 mihomo: {url}')
    download_file(url, tmp_gz)
    run(['gunzip', '-f', str(tmp_gz)])
    run(['install', '-m', '0755', str(tmp_bin), str(MIHOMO_BIN)])
    P.ok(f'mihomo 已安装到 {MIHOMO_BIN}')


def write_config(script_dir: Path):
    HOME_DIR.mkdir(parents=True, exist_ok=True)
    PROVIDER_DIR.mkdir(parents=True, exist_ok=True)
    PROVIDER_FILE.write_text('', encoding='utf-8')
    boot_mode = 'systemd' if has_systemd() else 'direct'
    default_sources = (script_dir / 'proxy_sources.txt').resolve()
    CTL_ENV.write_text(textwrap.dedent(f'''
        MIHOMO_API="http://127.0.0.1:9090"
        MIHOMO_SECRET=""
        MIXED_PORT="7890"
        SOCKS_PORT="7891"
        PROVIDER_NAME="pool"
        PROVIDER_FILE="{PROVIDER_FILE}"
        HOME_DIR="{HOME_DIR}"
        LOG_FILE="{LOG_FILE}"
        PID_FILE="{PID_FILE}"
        MIHOMO_BIN="{MIHOMO_BIN}"
        BOOT_MODE="{boot_mode}"
        DEFAULT_SOURCE_FILE="{default_sources}"
    ''').strip() + '\n', encoding='utf-8')
    CONFIG_FILE.write_text(textwrap.dedent('''
        mixed-port: 7890
        socks-port: 7891
        allow-lan: false
        mode: rule
        log-level: info
        ipv6: false

        external-controller: 127.0.0.1:9090
        secret: ""

        profile:
          store-selected: true
          store-fake-ip: true

        dns:
          enable: true
          listen: 127.0.0.1:1053
          ipv6: false
          enhanced-mode: redir-host
          nameserver:
            - https://1.1.1.1/dns-query
            - https://8.8.8.8/dns-query

        proxy-providers:
          pool:
            type: file
            path: ./providers/pool.txt
            health-check:
              enable: true
              url: https://www.gstatic.com/generate_204
              interval: 300
              timeout: 5000
              lazy: false

        proxy-groups:
          - name: AUTO
            type: url-test
            use:
              - pool
            url: https://www.gstatic.com/generate_204
            interval: 300
            lazy: false
            tolerance: 100

          - name: PROXY
            type: select
            use:
              - pool
            proxies:
              - AUTO
              - DIRECT

        rules:
          - MATCH,PROXY
    ''').lstrip(), encoding='utf-8')
    P.ok('配置文件已生成。')


PROXY_CLI = r'''#!/usr/bin/env python3
import json
import os
import re
import signal
import subprocess
import sys
import time
import base64
import urllib.request
import urllib.parse
from pathlib import Path

ENV_FILE = "/etc/mihomo/ctl.env"
SUPPORTED_SCHEMES = ("vless://", "vmess://", "ss://", "trojan://", "hysteria://", "hy2://", "tuic://")


def load_env():
    env = {}
    with open(ENV_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


CFG = load_env()
API = CFG["MIHOMO_API"].rstrip("/")
SECRET = CFG.get("MIHOMO_SECRET", "")
PROVIDER_NAME = CFG["PROVIDER_NAME"]
PROVIDER_FILE = Path(CFG["PROVIDER_FILE"])
HOME_DIR = Path(CFG["HOME_DIR"])
LOG_FILE = Path(CFG["LOG_FILE"])
PID_FILE = Path(CFG["PID_FILE"])
MIHOMO_BIN = CFG["MIHOMO_BIN"]
BOOT_MODE = CFG.get("BOOT_MODE", "direct")
DEFAULT_SOURCE_FILE = Path(CFG["DEFAULT_SOURCE_FILE"])


def out(msg=""):
    print(msg)


def err(msg):
    print(msg, file=sys.stderr)


def run(cmd, check=True, capture=True):
    p = subprocess.run(cmd, text=True, stdout=subprocess.PIPE if capture else None, stderr=subprocess.STDOUT if capture else None)
    if check and p.returncode != 0:
        tail = f"\n{p.stdout}" if capture and p.stdout else ""
        raise RuntimeError(f"command failed ({p.returncode}): {' '.join(cmd)}{tail}")
    return p


def api_request(path, method="GET", data=None, timeout=10):
    url = API + path
    headers = {"User-Agent": "proxy-cli/1.0"}
    if SECRET:
        headers["Authorization"] = f"Bearer {SECRET}"
    body = None
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            if not raw:
                return {}
            return json.loads(raw.decode("utf-8", errors="ignore"))
    except Exception as e:
        return {"_error": str(e)}


def b64_decode_loose(s: str) -> str:
    s = re.sub(r"\s+", "", s)
    pad = len(s) % 4
    if pad:
        s += "=" * (4 - pad)
    try:
        return base64.urlsafe_b64decode(s.encode()).decode("utf-8", errors="ignore")
    except Exception:
        return ""


def looks_like_base64_blob(text: str) -> bool:
    t = re.sub(r"\s+", "", text)
    if "://" in text:
        return False
    return bool(re.fullmatch(r"[A-Za-z0-9+/=_-]+", t))


def parse_lines(text: str):
    return [x.strip() for x in text.splitlines() if x.strip() and not x.strip().startswith("#")]


def extract_uri_lines(text: str):
    text = text.strip()
    if not text:
        return []
    if looks_like_base64_blob(text):
        decoded = b64_decode_loose(text)
        if decoded and "://" in decoded:
            text = decoded
    lines = []
    for line in parse_lines(text):
        if line.startswith(SUPPORTED_SCHEMES):
            lines.append(line)
    if not lines and text.startswith(SUPPORTED_SCHEMES):
        lines = [text]
    return lines


def fetch_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "proxy-cli/1.0"})
    with urllib.request.urlopen(req, timeout=25) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def node_name_from_uri(uri: str) -> str:
    try:
        if uri.startswith("vmess://"):
            raw = uri[len("vmess://"):]
            js = b64_decode_loose(raw)
            obj = json.loads(js)
            return (obj.get("ps") or "vmess").strip()
        parsed = urllib.parse.urlsplit(uri)
        frag = urllib.parse.unquote(parsed.fragment or "").strip()
        return frag or parsed.scheme
    except Exception:
        return "unknown"


def set_node_name(uri: str, new_name: str) -> str:
    try:
        if uri.startswith("vmess://"):
            raw = uri[len("vmess://"):]
            js = b64_decode_loose(raw)
            obj = json.loads(js)
            obj["ps"] = new_name
            data = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            return "vmess://" + base64.b64encode(data).decode()
        parsed = urllib.parse.urlsplit(uri)
        return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, urllib.parse.quote(new_name, safe="")))
    except Exception:
        return uri


def load_pool_lines():
    if not PROVIDER_FILE.exists():
        return []
    return [x.strip() for x in PROVIDER_FILE.read_text(encoding="utf-8", errors="ignore").splitlines() if x.strip()]


def uniquify_names(lines):
    counts = {}
    out = []
    for line in lines:
        base = node_name_from_uri(line) or "node"
        n = counts.get(base, 0) + 1
        counts[base] = n
        name = base if n == 1 else f"{base} #{n}"
        out.append(set_node_name(line, name))
    return out


def dedupe_by_uri(lines):
    seen = set()
    out_lines = []
    for line in lines:
        if line not in seen:
            seen.add(line)
            out_lines.append(line)
    return uniquify_names(out_lines)


def save_pool_lines(lines):
    PROVIDER_FILE.parent.mkdir(parents=True, exist_ok=True)
    lines = dedupe_by_uri(lines)
    PROVIDER_FILE.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def resolve_source_to_nodes(source: str, visited=None):
    if visited is None:
        visited = set()
    key = os.path.abspath(source) if os.path.exists(source) else source
    if key in visited:
        return []
    visited.add(key)

    if os.path.exists(source):
        text = Path(source).read_text(encoding="utf-8", errors="ignore")
        nodes = extract_uri_lines(text)
        if nodes:
            return nodes
        merged = []
        for item in parse_lines(text):
            merged.extend(resolve_source_to_nodes(item, visited))
        return merged

    if source.startswith("http://") or source.startswith("https://"):
        text = fetch_text(source)
        nodes = extract_uri_lines(text)
        if nodes:
            return nodes
        merged = []
        for item in parse_lines(text):
            merged.extend(resolve_source_to_nodes(item, visited))
        return merged

    nodes = extract_uri_lines(source)
    if nodes:
        return nodes

    if "\n" in source:
        merged = []
        for item in parse_lines(source):
            merged.extend(resolve_source_to_nodes(item, visited))
        return merged
    return []


def pid_running():
    if not PID_FILE.exists():
        return False
    try:
        pid = int(PID_FILE.read_text().strip())
        os.kill(pid, 0)
        return True
    except Exception:
        try:
            PID_FILE.unlink()
        except Exception:
            pass
        return False


def wait_api(timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        ver = api_request("/version", timeout=2)
        if not ver.get("_error"):
            return True
        time.sleep(0.5)
    return False


def start_core():
    if BOOT_MODE == "systemd":
        p = run(["systemctl", "start", "mihomo"], check=False)
        if p.returncode != 0:
            err("启动失败，请检查 systemd 日志。")
            return 1
    else:
        if pid_running():
            out("mihomo 已在运行。")
            return 0
        HOME_DIR.mkdir(parents=True, exist_ok=True)
        with open(LOG_FILE, "ab") as logf:
            proc = subprocess.Popen([MIHOMO_BIN, "-d", str(HOME_DIR)], stdout=logf, stderr=subprocess.STDOUT, start_new_session=True)
        PID_FILE.write_text(str(proc.pid), encoding="utf-8")
    if wait_api():
        out("代理核心已启动。")
        return 0
    err("代理核心启动超时，请查看日志。")
    return 1


def stop_core():
    if BOOT_MODE == "systemd":
        run(["systemctl", "stop", "mihomo"], check=False)
        out("代理核心已停止。")
        return 0
    if not pid_running():
        out("mihomo 未运行。")
        return 0
    try:
        pid = int(PID_FILE.read_text().strip())
        os.kill(pid, signal.SIGTERM)
        for _ in range(30):
            try:
                os.kill(pid, 0)
                time.sleep(0.2)
            except OSError:
                break
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass
    except Exception:
        pass
    try:
        PID_FILE.unlink()
    except Exception:
        pass
    out("代理核心已停止。")
    return 0


def refresh_provider():
    res = api_request(f"/providers/proxies/{PROVIDER_NAME}", method="PUT", timeout=15)
    return "_error" not in res


def healthcheck_provider():
    res = api_request(f"/providers/proxies/{PROVIDER_NAME}/healthcheck", method="GET", timeout=30)
    return "_error" not in res


def get_provider_data():
    return api_request(f"/providers/proxies/{PROVIDER_NAME}", method="GET", timeout=15)


def get_proxy_group():
    return api_request("/proxies/PROXY", method="GET", timeout=10)


def get_version():
    return api_request("/version", method="GET", timeout=5)


def set_current_proxy(name: str):
    res = api_request("/proxies/PROXY", method="PUT", data={"name": name}, timeout=10)
    return "_error" not in res


def parse_provider_proxies(data):
    proxies = data.get("proxies", [])
    if isinstance(proxies, dict):
        proxies = list(proxies.values())
    out_items = []
    for p in proxies:
        if not isinstance(p, dict):
            continue
        name = p.get("name") or ""
        alive = p.get("alive")
        history = p.get("history") or []
        delay = None
        for h in reversed(history):
            if isinstance(h, dict) and isinstance(h.get("delay"), int) and h.get("delay", 0) > 0:
                delay = h["delay"]
                break
        out_items.append({"name": name, "alive": alive, "delay": delay})
    return out_items


def status_icon(item):
    if item.get("delay") is not None:
        return "OK"
    if item.get("alive") is False:
        return "XX"
    return "--"


def local_items():
    items = []
    for idx, line in enumerate(load_pool_lines(), 1):
        items.append({"idx": idx, "name": node_name_from_uri(line), "delay": None, "alive": None, "line": line})
    return items


def remote_items():
    pdata = get_provider_data()
    if pdata.get("_error"):
        return None
    items = []
    for idx, p in enumerate(parse_provider_proxies(pdata), 1):
        p["idx"] = idx
        items.append(p)
    return items


def current_selected_name():
    group = get_proxy_group()
    if group.get("_error"):
        return None
    return group.get("now") or group.get("name")


def show_list(items, current=None):
    for item in items:
        mark = "*" if current and item["name"] == current else " "
        delay = f"{item['delay']} ms" if item.get("delay") is not None else "-"
        out(f"[{item['idx']:>3}] {mark} {status_icon(item):>2}  {delay:>8}  {item['name']}")


def ensure_started():
    ver = get_version()
    return "_error" not in ver


def cmd_help():
    out("""proxy 使用说明:
  proxy on                      启动代理核心，并为当前 shell 打开代理环境变量
  proxy off                     关闭代理环境变量，并停止代理核心
  proxy add                     从默认 proxy_sources.txt 同步导入
  proxy add <来源>              导入订阅链接 / 单节点 URI / 本地 txt 文件
  proxy list                    列出所有节点并显示编号
  proxy select                  交互式选择节点
  proxy select <编号|名称|auto> 选择指定节点，或切回 AUTO
  proxy check                   测试全部节点连通性并显示结果
  proxy fastest                 测试全部节点并切换到最快节点
  proxy status                  查看运行状态、当前节点和数量统计
  proxy remove fail             测试全部节点并删除失效节点
  proxy remove <编号>           删除指定编号的节点
  proxy help                    显示本帮助

说明:
  1. 第一次使用前，请先执行: source /etc/profile.d/proxy.sh
  2. 默认来源文件: {default_source}
  3. check / fastest / remove fail 依赖 mihomo 已启动
""".format(default_source=DEFAULT_SOURCE_FILE))
    return 0


def cmd_on():
    rc = start_core()
    if rc == 0:
        out("如需在当前 shell 生效代理环境变量，请先执行: source /etc/profile.d/proxy.sh")
    return rc


def cmd_off():
    return stop_core()


def cmd_add(source=None):
    specs = [source] if source else [str(DEFAULT_SOURCE_FILE)]
    merged_nodes = []
    for spec in specs:
        nodes = resolve_source_to_nodes(spec)
        if not nodes:
            out(f"跳过空来源: {spec}")
            continue
        merged_nodes.extend(nodes)
    if not merged_nodes:
        err("未识别到任何可导入节点。")
        return 1
    old = load_pool_lines()
    save_pool_lines(old + merged_nodes)
    total = len(load_pool_lines())
    out(f"已导入 {len(merged_nodes)} 条节点，当前共 {total} 条。")
    if ensure_started():
        refresh_provider()
        out("已通知 mihomo 刷新 provider。")
    else:
        out("mihomo 当前未运行，节点已写入本地池。")
    return 0


def cmd_status():
    running = ensure_started()
    out(f"运行模式: {BOOT_MODE}")
    out(f"默认来源: {DEFAULT_SOURCE_FILE}")
    out(f"本地节点池: {PROVIDER_FILE}")
    out(f"核心运行: {'是' if running else '否'}")
    if not running:
        out(f"节点总数: {len(load_pool_lines())}")
        return 0
    ver = get_version()
    current = current_selected_name()
    items = remote_items() or []
    alive = sum(1 for x in items if x.get("delay") is not None)
    out(f"mihomo version: {ver.get('version', 'unknown')}")
    out(f"当前节点: {current}")
    out(f"节点总数: {len(items)}  可用: {alive}  疑似失效: {len(items) - alive}")
    top = sorted([x for x in items if x.get("delay") is not None], key=lambda x: x["delay"])[:5]
    if top:
        out("最快节点前 5:")
        show_list(top, current=current)
    return 0


def cmd_list():
    current = current_selected_name() if ensure_started() else None
    items = remote_items() if ensure_started() else None
    if items is None:
        items = local_items()
    if not items:
        out("当前没有节点。")
        return 0
    show_list(items, current=current)
    return 0


def run_healthcheck(wait_seconds=6):
    if not ensure_started():
        err("mihomo 未运行，请先执行 proxy on")
        return None
    ok = healthcheck_provider()
    if not ok:
        err("无法触发健康检查。")
        return None
    time.sleep(wait_seconds)
    items = remote_items()
    if items is None:
        err("读取健康检查结果失败。")
        return None
    return items


def cmd_check():
    items = run_healthcheck()
    if items is None:
        return 1
    current = current_selected_name()
    show_list(items, current=current)
    alive = sum(1 for x in items if x.get("delay") is not None)
    out(f"测试完成：可用 {alive} / 总数 {len(items)}")
    return 0


def choose_fastest(items):
    alive = [x for x in items if x.get("delay") is not None]
    if not alive:
        return None
    return sorted(alive, key=lambda x: x["delay"])[0]


def cmd_fastest():
    items = run_healthcheck()
    if items is None:
        return 1
    best = choose_fastest(items)
    if not best:
        err("没有可用节点。")
        return 1
    if set_current_proxy(best["name"]):
        out(f"已切换到最快节点: {best['name']} ({best['delay']} ms)")
        return 0
    err("切换最快节点失败。")
    return 1


def get_items_for_indexing():
    items = remote_items() if ensure_started() else None
    return items or local_items()


def cmd_select(arg=None):
    if not ensure_started():
        err("mihomo 未运行，请先执行 proxy on")
        return 1
    items = remote_items() or []
    if not items:
        err("没有可选节点。")
        return 1
    if arg is None:
        current = current_selected_name()
        show_list(items, current=current)
        raw = input("输入节点编号（或 auto）: ").strip()
        if not raw:
            out("已取消。")
            return 0
        arg = raw
    if str(arg).lower() == 'auto':
        if set_current_proxy('AUTO'):
            out('已切换到 AUTO。')
            return 0
        err('切换到 AUTO 失败。')
        return 1
    target = None
    if str(arg).isdigit():
        idx = int(arg)
        for item in items:
            if item['idx'] == idx:
                target = item['name']
                break
    else:
        target = str(arg)
    if not target:
        err('未找到对应节点。')
        return 1
    if set_current_proxy(target):
        out(f'已切换到节点: {target}')
        return 0
    err('切换节点失败。')
    return 1


def cmd_remove(arg=None):
    if arg is None:
        err('用法: proxy remove fail | proxy remove <编号>')
        return 1
    if str(arg).lower() == 'fail':
        items = run_healthcheck()
        if items is None:
            return 1
        dead_names = {x['name'] for x in items if x.get('delay') is None or x.get('alive') is False}
        if not dead_names:
            out('没有失效节点。')
            return 0
        old = load_pool_lines()
        kept = []
        removed = []
        for line in old:
            name = node_name_from_uri(line)
            if name in dead_names:
                removed.append(name)
            else:
                kept.append(line)
        save_pool_lines(kept)
        if ensure_started():
            refresh_provider()
        out(f'已删除 {len(removed)} 条失效节点；剩余 {len(kept)} 条。')
        for name in removed[:20]:
            out(f'  - {name}')
        return 0

    if not str(arg).isdigit():
        err('删除指定节点时请传编号，例如: proxy remove 3')
        return 1

    idx = int(arg)
    old = load_pool_lines()
    if idx < 1 or idx > len(old):
        err('编号超出范围。')
        return 1
    target_name = node_name_from_uri(old[idx - 1])
    del old[idx - 1]
    save_pool_lines(old)
    if ensure_started():
        refresh_provider()
    out(f'已删除节点: [{idx}] {target_name}')
    return 0


def main(argv=None):
    argv = argv or sys.argv[1:]
    if not argv:
        return cmd_help()
    cmd = argv[0].lower()
    if cmd == 'help':
        return cmd_help()
    if cmd == '_start':
        return start_core()
    if cmd == '_stop':
        return stop_core()
    if cmd == 'on':
        return cmd_on()
    if cmd == 'off':
        return cmd_off()
    if cmd == 'add':
        return cmd_add(argv[1] if len(argv) > 1 else None)
    if cmd == 'status':
        return cmd_status()
    if cmd == 'list':
        return cmd_list()
    if cmd == 'check':
        return cmd_check()
    if cmd == 'fastest':
        return cmd_fastest()
    if cmd == 'select':
        return cmd_select(argv[1] if len(argv) > 1 else None)
    if cmd == 'remove':
        return cmd_remove(argv[1] if len(argv) > 1 else None)
    err(f'未知命令: {cmd}')
    return cmd_help() or 1


if __name__ == '__main__':
    raise SystemExit(main())
'''


def write_proxy_cli():
    PROXY_BIN.write_text(PROXY_CLI, encoding='utf-8')
    PROXY_BIN.chmod(0o755)
    P.ok(f'命令行工具已写入 {PROXY_BIN}')


PROFILE_SCRIPT = r'''[ -f /etc/mihomo/ctl.env ] && . /etc/mihomo/ctl.env

_proxy_set_env() {
  export http_proxy="http://127.0.0.1:${MIXED_PORT}"
  export https_proxy="$http_proxy"
  export HTTP_PROXY="$http_proxy"
  export HTTPS_PROXY="$http_proxy"

  export all_proxy="socks5://127.0.0.1:${SOCKS_PORT}"
  export ALL_PROXY="$all_proxy"

  export no_proxy="localhost,127.0.0.1,::1"
  export NO_PROXY="$no_proxy"
}

_proxy_clear_env() {
  unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
  unset all_proxy ALL_PROXY
  unset no_proxy NO_PROXY
}

proxy() {
  case "$1" in
    on)
      command proxy _start || return $?
      _proxy_set_env
      echo "代理已开启"
      echo "  http_proxy=$http_proxy"
      echo "  all_proxy=$all_proxy"
      ;;
    off)
      _proxy_clear_env
      command proxy _stop
      echo "代理已关闭"
      ;;
    help|-h|--help|"")
      command proxy help
      ;;
    *)
      command proxy "$@"
      ;;
  esac
}
'''


def write_profile_script():
    PROFILE_FILE.write_text(PROFILE_SCRIPT, encoding='utf-8')
    PROFILE_FILE.chmod(0o644)
    P.ok(f'shell 函数已写入 {PROFILE_FILE}')


SERVICE_TEXT = textwrap.dedent('''
    [Unit]
    Description=mihomo proxy daemon
    After=network-online.target
    Wants=network-online.target

    [Service]
    Type=simple
    ExecStart=/usr/local/bin/mihomo -d /etc/mihomo
    Restart=always
    RestartSec=3
    LimitNOFILE=1048576

    [Install]
    WantedBy=multi-user.target
''').lstrip()


def write_service_if_needed():
    if not has_systemd():
        P.warn('当前环境无 systemd，已切换为 direct 后台模式。')
        return
    SYSTEMD_SERVICE.write_text(SERVICE_TEXT, encoding='utf-8')
    run(['systemctl', 'daemon-reload'], check=False)
    run(['systemctl', 'enable', SERVICE_NAME], check=False)
    P.ok('systemd 服务已安装。')


def ensure_bashrc_source():
    target_user = os.environ.get('SUDO_USER') or os.environ.get('USER') or 'root'
    home = Path('/root') if target_user == 'root' else Path('/home') / target_user
    bashrc = home / '.bashrc'
    line = 'source /etc/profile.d/proxy.sh'
    try:
        content = bashrc.read_text(encoding='utf-8', errors='ignore') if bashrc.exists() else ''
        if line not in content:
            with open(bashrc, 'a', encoding='utf-8') as f:
                if content and not content.endswith('\n'):
                    f.write('\n')
                f.write(line + '\n')
        P.ok(f'已确保 {bashrc} 会加载 proxy 命令。')
    except Exception as e:
        P.warn(f'写入 {bashrc} 失败: {e}')


def first_sync_sources(script_dir: Path):
    source_file = script_dir / 'proxy_sources.txt'
    if not source_file.exists():
        P.warn(f'未找到默认来源文件: {source_file}')
        return
    P.info(f'首次同步来源文件: {source_file}')
    p = run([str(PROXY_BIN), 'add', str(source_file)], check=False, capture=True)
    if p.stdout:
        print(p.stdout.rstrip())
    if p.returncode == 0:
        P.ok('默认来源已同步。')
    else:
        P.warn('默认来源同步未成功，你稍后可以手动执行: proxy add')


def write_template_sources(script_dir: Path):
    tpl = script_dir / 'proxy_sources.txt'
    if tpl.exists():
        return
    tpl.write_text(textwrap.dedent('''
        # 每行一个来源；支持以下任一形式：
        # 1) 订阅链接
        # https://example.com/sub?token=xxxx
        #
        # 2) 单条节点 URI
        # vless://uuid@example.com:443?encryption=none&security=tls&type=ws&host=example.com&path=%2Fws#tokyo
        #
        # 3) 本地 txt 文件路径（文件里可放多条 vless/vmess/ss/trojan...）
        # /root/my_nodes.txt
    ''').lstrip(), encoding='utf-8')
    P.ok(f'已生成模板来源文件: {tpl}')


def main():
    ensure_root()
    parser = argparse.ArgumentParser(description='安装一体化 proxy 命令')
    parser.parse_args()
    script_dir = Path(__file__).resolve().parent

    P.title('proxy 一键安装')

    P.next('安装依赖并准备进度显示')
    apt_install_packages()

    P.next('清理旧安装并恢复到初始状态')
    cleanup_old_install()

    P.next('检查并安装 mihomo')
    install_mihomo_if_needed()

    P.next('写入 mihomo 配置')
    write_config(script_dir)

    P.next('安装 proxy 主命令')
    write_proxy_cli()

    P.next('安装 shell 命令入口')
    write_profile_script()

    P.next('安装 systemd 服务或 direct 模式')
    write_service_if_needed()

    P.next('准备来源文件并首次同步')
    write_template_sources(script_dir)
    first_sync_sources(script_dir)

    P.next('设置登录自动加载')
    ensure_bashrc_source()

    P.title('安装完成')
    print(textwrap.dedent(f'''
        已完成安装。现在请执行：
          source /etc/profile.d/proxy.sh

        常用命令：
          proxy on
          proxy off
          proxy add
          proxy list
          proxy select
          proxy check
          proxy fastest
          proxy remove fail
          proxy remove 3
          proxy status
          proxy help

        默认来源文件：
          {script_dir / 'proxy_sources.txt'}
    ''').strip())


if __name__ == '__main__':
    main()
```
