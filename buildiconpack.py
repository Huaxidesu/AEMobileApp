"""把 assets/itempanel.db 打包成在线更新用的图标包（原库 + gzip + 版本清单）。

产物结构（推送到 Gitea 后 App 从这里拉）：
  <out>/version.json            版本清单：版本号、sha256、大小、行数
  <out>/icons/itempanel.db      原库，App 直接下载（原生流式写盘，无需解压）
  <out>/icons/itempanel.db.gz   压缩版（110MB → 48MB），留给桌面端/以后的原生解压

用法：
  python buildiconpack.py --out "D:/Develop/Game/update/dsmgtnhupdate/ae"
  python buildiconpack.py --out ... --version 2026.10.26-2 --note "补 3 个空图标"

App 侧判定规则：比对清单里的 sha256 与本地已安装库的 sha256，不同即可更新；
version 只用于人看/日志，不参与比较（避免版本号排序踩坑）。
"""

import argparse
import gzip
import hashlib
import json
import os
import sqlite3
import sys
import time

BASE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB = os.path.join(BASE, "assets", "itempanel.db")


def sha256Of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DEFAULT_DB, help="源 sqlite（默认 assets/itempanel.db）")
    ap.add_argument("--out", required=True, help="更新仓库里的输出目录，如 .../dsmgtnhupdate/ae")
    ap.add_argument("--version", default=None, help="版本号，默认用当天日期 -N")
    ap.add_argument("--note", default="", help="更新说明，展示给 App")
    args = ap.parse_args()

    if not os.path.isfile(args.db):
        print("[中止] 找不到 %s" % args.db)
        sys.exit(1)

    db = sqlite3.connect(args.db)
    rows = db.execute("select count(*) from item_panel").fetchone()[0]
    keys = db.execute("select count(*) from (select distinct item_name, item_meta from item_panel)").fetchone()[0]
    fluids = db.execute("select count(*) from fluid_container").fetchone()[0]
    db.close()

    version = args.version or time.strftime("%Y.%m.%d") + "-1"
    outDir = args.out
    iconDir = os.path.join(outDir, "icons")
    os.makedirs(iconDir, exist_ok=True)

    rawSize = os.path.getsize(args.db)
    digest = sha256Of(args.db)

    # 原库：App 直接下载，省掉客户端解压
    rawPath = os.path.join(iconDir, "itempanel.db")
    if os.path.abspath(rawPath) != os.path.abspath(args.db):
        with open(args.db, "rb") as src, open(rawPath, "wb") as dst:
            for chunk in iter(lambda: src.read(4 * 1024 * 1024), b""):
                dst.write(chunk)

    t = time.time()
    gzPath = os.path.join(iconDir, "itempanel.db.gz")
    tmpPath = gzPath + ".tmp"
    # mtime=0 让同一份输入产出同一个字节流，便于判断"是否真的变了"
    with open(args.db, "rb") as src, gzip.GzipFile(tmpPath, "wb", compresslevel=6, mtime=0) as dst:
        for chunk in iter(lambda: src.read(1024 * 1024), b""):
            dst.write(chunk)
    os.replace(tmpPath, gzPath)
    gzSize = os.path.getsize(gzPath)

    manifest = {
        "schema": 1,
        "updated": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "note": args.note,
        "icons": {
            "version": version,
            "sha256": digest,
            "size": rawSize,
            "file": "icons/itempanel.db",
            "rows": rows,
            "keys": keys,
            "fluids": fluids,
            "gzFile": "icons/itempanel.db.gz",
            "gzSize": gzSize,
        },
    }
    manifestPath = os.path.join(outDir, "version.json")
    with open(manifestPath, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print("版本     %s" % version)
    print("卸载后   %.1f MB → 压缩 %.1f MB（%.0f%%，耗时 %.0fs）"
          % (rawSize / 1048576, gzSize / 1048576, gzSize / rawSize * 100, time.time() - t))
    print("内容     %d 行 / %d 键 / %d 流体" % (rows, keys, fluids))
    print("sha256   %s" % digest)
    print("提示     若这份库要随 APK 分发，记得把 src/iconpack.ts 的 BUILTIN_ICON_SHA 改成上面的值")
    print("产物     %s  +  %s" % (manifestPath, gzPath))


main()
