"""把三个图标库打包成在线更新用的产物（原库 + gzip + 版本清单）。

2026-10-28 起拆成三个库，清单也分开写：
  <out>/version.json           { schema:2, items:{...}, fluids:{...}, essentia:{...} }
  <out>/icons/items.db         物品库（186MB）
  <out>/icons/fluids.db        流体库（216KB）
  <out>/icons/essentia.db      源质库（180KB）
每个库都有 sha256/size/rows，App 可以只下载变了的那个。

用法：
  python buildiconpack.py --out "D:/Develop/Game/update/dsmgtnhupdate/ae"
  python buildiconpack.py --out ... --version 2026.10.28-1 --note "补矿石图标"

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
ASSETS = os.path.join(BASE, "assets")
DEFAULT_ITEMS = os.path.join(ASSETS, "items.db")
DEFAULT_FLUIDS = os.path.join(ASSETS, "fluids.db")
DEFAULT_ESSENTIA = os.path.join(ASSETS, "essentia.db")


def sha256Of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def packOne(name, path, outDir, version, counts):
    """把一个库复制进 icons/ 并返回清单条目"""
    if not os.path.isfile(path):
        return None
    rawSize = os.path.getsize(path)
    digest = sha256Of(path)
    target = os.path.join(outDir, "icons", "%s.db" % name)
    if os.path.abspath(target) != os.path.abspath(path):
        with open(path, "rb") as src, open(target, "wb") as dst:
            for chunk in iter(lambda: src.read(4 * 1024 * 1024), b""):
                dst.write(chunk)
    gzPath = target + ".gz"
    with open(path, "rb") as src, gzip.GzipFile(gzPath, "wb", compresslevel=6, mtime=0) as dst:
        for chunk in iter(lambda: src.read(1024 * 1024), b""):
            dst.write(chunk)
    info = {
        "version": version,
        "sha256": digest,
        "size": rawSize,
        "file": "icons/%s.db" % name,
        "gzFile": "icons/%s.db.gz" % name,
        "gzSize": os.path.getsize(gzPath),
    }
    info.update(counts.get(name, {}))
    return info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--items", default=DEFAULT_ITEMS, help="物品库（默认 assets/items.db）")
    ap.add_argument("--fluids", default=DEFAULT_FLUIDS, help="流体库（默认 assets/fluids.db）")
    ap.add_argument("--essentia", default=DEFAULT_ESSENTIA, help="源质库（默认 assets/essentia.db）")
    ap.add_argument("--out", required=True, help="更新仓库里的输出目录，如 .../dsmgtnhupdate/ae")
    ap.add_argument("--version", default=None, help="版本号，默认用当天日期 -N")
    ap.add_argument("--note", default="", help="更新说明，展示给 App")
    args = ap.parse_args()

    if not os.path.isfile(args.items):
        print("[中止] 找不到 %s" % args.items)
        sys.exit(1)

    version = args.version or time.strftime("%Y.%m.%d") + "-1"
    outDir = args.out
    os.makedirs(os.path.join(outDir, "icons"), exist_ok=True)

    counts = {}
    db = sqlite3.connect(args.items)
    counts["items"] = {
        "rows": db.execute("select count(*) from item_panel").fetchone()[0],
        "keys": db.execute(
            "select count(*) from (select distinct item_name, item_meta from item_panel)").fetchone()[0],
    }
    db.close()
    for name, path, sql in (("fluids", args.fluids, "select count(*) from fluid_container"),
                            ("essentia", args.essentia, "select count(*) from aspect")):
        try:
            c = sqlite3.connect(path)
            counts[name] = {"rows": c.execute(sql).fetchone()[0]}
            c.close()
        except Exception:
            counts[name] = {}

    manifest = {
        "schema": 2,
        "updated": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "note": args.note,
    }
    for name, path in (("items", args.items), ("fluids", args.fluids), ("essentia", args.essentia)):
        info = packOne(name, path, outDir, version, counts)
        if info:
            manifest[name] = info
    # 老版本 App 只认 icons 字段，指到物品库，别让它们看到空清单
    if "items" in manifest:
        manifest["icons"] = manifest["items"]

    manifestPath = os.path.join(outDir, "version.json")
    with open(manifestPath, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print("版本     %s" % version)
    for name in ("items", "fluids", "essentia"):
        if name in manifest:
            i = manifest[name]
            print("  %-8s %.1f MB → gz %.1f MB  sha256 %s  %s"
                  % (name, i["size"] / 1048576, i["gzSize"] / 1048576, i["sha256"][:12], i.get("rows", "")))
    print("提示     物品库随 APK 分发时，把 src/iconpack.ts 的 BUILTIN_ICON_SHA 改成 items 的 sha256")
    print("产物     %s" % manifestPath)


main()
