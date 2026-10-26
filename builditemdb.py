"""从 NEI 导出的三件套重建或合并 assets/itempanel.db。

输入（默认取本文件同目录，可用 --src 指定，如 NEI 的 dumps 目录）：
  itempanel.csv        NEI「数据导出 → 物品面板 → CSV」
  itempanel_icons/     NEI「数据导出 → 物品面板 → PNG」，分辨率 128
  fluidcontainer.csv   NEIIntegration 的流体容器导出（重建模式必需）
输出：
  itempanel.db         需手动覆盖到 assets/itempanel.db

用法：
  python builditemdb.py --src "<dumps 路径>"            重建（先删后建，需三件套齐全）
  python builditemdb.py --src "<dumps 路径>" --merge    以 assets/itempanel.db 为底，按
                                                        item_name+item_meta 覆盖/新增
  --force   缺图标比例过高时也继续（默认中止）
"""

import base64
import collections
import csv
import os
import shutil
import sqlite3
import struct
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
DB_OUT = os.path.join(BASE, "itempanel.db")
DB_BASE = os.path.join(BASE, "assets", "itempanel.db")


def parseArgs(argv):
    opts = {"force": False, "merge": False, "src": BASE}
    i = 1
    while i < len(argv):
        a = argv[i]
        if a == "--force":
            opts["force"] = True
        elif a == "--merge":
            opts["merge"] = True
        elif a == "--src":
            i += 1
            if i >= len(argv):
                abort("--src 缺少路径参数", '例：--src "D:/.../.minecraft/dumps"')
            opts["src"] = os.path.abspath(argv[i])
        else:
            abort("未知参数 %s" % a, "支持 --src <dir> / --merge / --force")
        i += 1
    return opts


def abort(msg, hint):
    print("[中止] " + msg)
    print("       " + hint)
    sys.exit(1)


illegalChars = [ 34, 60, 62, 124, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 58, 42, 63, 92, 47 ]
def replaceIllegalChars(s):
    for c in illegalChars:
        s = s.replace(chr(c), '_')
    return s


def pngSize(path):
    """读 PNG 头部拿宽高，非 PNG 返回 None。"""
    try:
        with open(path, "rb") as f:
            head = f.read(24)
    except OSError:
        return None
    if len(head) < 24 or head[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">II", head[16:24])


def createSchema(cur):
    cur.execute("""
    create table if not exists item_panel (
        id integer primary key,
        item_name string,
        item_id string,
        item_meta string,
        has_nbt string,
        dname string,
        icon string
    );
    """)
    cur.execute(
    """
    create table if not exists fluid_container (
        id integer primary key,
        fluid_name string,
        item string,
        meta string,
        container_display_name string,
        amount integer);
    """)
    cur.execute("create index if not exists idx_item_name on item_panel(item_name)")
    cur.execute("create index if not exists idx_item_id on item_panel(item_id)")
    cur.execute("create index if not exists idx_item_meta on item_panel(item_meta)")


def toMeta(raw):
    """csv 里 meta 是字符串；现有库里是 INTEGER，统一成 int 才能按 (name, meta) 对齐。"""
    try:
        return int(float(raw))
    except (TypeError, ValueError):
        return raw


def iconCandidates(dname):
    """NEI 落盘名的兜底候选：显示名首尾可能带被清洗成 '_' 的控制符，重名会加 _2/_3。"""
    base = replaceIllegalChars(dname)
    yield base + '.png'
    yield '_' + base + '_.png'
    yield base + '_.png'
    yield '_' + base + '.png'
    for i in range(2, 6):
        yield '%s_%d.png' % (base, i)


def loadRows(itemCsv, iconDir):
    """读 csv + 按显示名取图标，返回 (行字典列表, 缺图标名单)。"""
    files = set(os.listdir(iconDir))
    data = []
    missing = []
    with open(itemCsv, encoding="utf-8") as csvf:
        reader = csv.DictReader(csvf)
        for i, row in enumerate(reader):
            d = {'id': i}
            dname = row['Display Name']
            d['dname'] = dname
            d['item_name'] = row['Item Name']
            d['item_id'] = row['Item ID']
            d['item_meta'] = toMeta(row['Item meta'])
            d['has_nbt'] = row['Has NBT']
            d['icon'] = None
            for cand in iconCandidates(dname):
                if cand in files:
                    try:
                        with open(os.path.join(iconDir, cand), 'rb') as f:
                            d['icon'] = base64.b64encode(f.read())
                    except OSError:
                        d['icon'] = None
                    break
            if d['icon'] is None:
                missing.append(dname)
            data.append(d)
    return data, missing


def loadFluids(fluidCsv):
    data = []
    i = 0
    f = {}
    with open(fluidCsv, encoding="utf-8") as csvf:
        reader = csv.DictReader(csvf)
        for row in reader:
            c = row['Fluid']
            if c not in f:
                f[c] = [row['Filled Container Display Name'], row['Amount'], row['Filled Container'][2:],row['Filled Container Item']]
            elif 'bartworks' in f[c][3] and '胶囊' in f[c][0]:
                print(f[c][0])
                f[c] = [row['Filled Container Display Name'], row['Amount'], row['Filled Container'][2:],row['Filled Container Item']]
    for fluid in f.keys():
        data.append({'id':i, 'fluid_name':fluid, 'item':f[fluid][3], 'meta':f[fluid][2].split("@")[1], 'dname':f[fluid][0], 'amount':f[fluid][1]})
        i = i +1
    return data


def main():
    opts = parseArgs(sys.argv)
    src = opts["src"]
    itemCsv = os.path.join(src, "itempanel.csv")
    iconDir = os.path.join(src, "itempanel_icons")
    fluidCsv = os.path.join(src, "fluidcontainer.csv")

    # ---- 前置校验：三件套缺一不可，缺口图标会让 App 大面积显示占位图 ----
    if not os.path.isfile(itemCsv):
        abort("缺少 itempanel.csv（%s）" % src, "NEI → 数据导出 → 物品面板 → CSV")
    if not os.path.isdir(iconDir):
        abort("缺少 itempanel_icons/（%s）" % src, "NEI → 数据导出 → 物品面板 → PNG，分辨率选 128")

    iconFiles = [f for f in os.listdir(iconDir) if f.lower().endswith(".png")]
    if not iconFiles:
        abort(
            "itempanel_icons/ 是空的（0 张 PNG），不能建库",
            "图标导出要在世界里、NEI 物品列表加载完成后再执行；成功的标志是目录里有上万张 png",
        )

    sizes = collections.Counter(s for s in (pngSize(os.path.join(iconDir, f)) for f in iconFiles[:500]) if s)
    print("图标文件 %d 张，抽样尺寸分布 %s" % (len(iconFiles), sizes.most_common(3)))
    if sizes:
        width = sizes.most_common(1)[0][0][0]
        if width < 64:
            print("[警告] 图标分辨率只有 %dpx，App 内按 40dp(3x≈120px) 显示会发糊；建议重新导出为 128" % width)

    if not opts["merge"] and not os.path.isfile(fluidCsv):
        abort("缺少 fluidcontainer.csv（重建模式必需）", "NEIIntegration → 数据导出 → 流体容器；或用 --merge 保留原有流体表")

    rows, missing = loadRows(itemCsv, iconDir)
    total = len(rows)
    missRate = (len(missing) / total) if total else 0
    print("csv %d 行，缺图标 %d 行（%.1f%%）" % (total, len(missing), missRate * 100))
    if missing:
        print("  缺图标示例: %s" % missing[:5])
    if missRate > 0.2 and not opts["force"]:
        abort(
            "缺图标比例 %.1f%% 过高，覆盖会严重不全" % (missRate * 100),
            "多半是图标没导全/分辨率不匹配；确认无误可加 --force",
        )

    if os.path.exists(DB_OUT):
        os.remove(DB_OUT)

    if opts["merge"]:
        # ---- 合并模式：以现有 assets/itempanel.db 为底，按 (item_name, item_meta) 覆盖/新增 ----
        # 逐行 UPDATE 带 100KB 图标会反复重写索引，慢到分钟级；这里改成整表重建：
        # 旧表里“新数据没覆盖到的行” + 新数据行 → 新表 → 换名重建索引。
        if not os.path.isfile(DB_BASE):
            abort("--merge 需要底库 %s" % DB_BASE, "先 checkout 现有 assets/itempanel.db，或改用重建模式")
        shutil.copyfile(DB_BASE, DB_OUT)
        db = sqlite3.connect(DB_OUT)
        cur = db.cursor()
        createSchema(cur)
        before = cur.execute("select count(*) from item_panel").fetchone()[0]

        cur.execute("drop table if exists _new_items")
        cur.execute("create table _new_items (item_name string, item_id string, item_meta string, has_nbt string, dname string, icon string)")
        cur.executemany(
            "insert into _new_items values(:item_name, :item_id, :item_meta, :has_nbt, :dname, :icon)", rows)
        cur.execute("create index _new_items_key on _new_items(item_name, item_meta)")

        # 没有图标的行（重名 _2 瑕疵）留在旧表里，避免把已有图标覆盖成空
        kept = cur.execute("""
            select count(*) from item_panel o
            where exists (select 1 from _new_items n
                          where n.item_name = o.item_name and n.item_meta = o.item_meta and n.icon is null)
        """).fetchone()[0]
        cur.execute("""
            delete from _new_items
            where icon is null and exists (select 1 from item_panel o
                                           where o.item_name = _new_items.item_name
                                             and o.item_meta = _new_items.item_meta)
        """)

        updated = cur.execute("""
            select count(*) from _new_items n where exists (select 1 from item_panel o
                where o.item_name = n.item_name and o.item_meta = n.item_meta)
        """).fetchone()[0]
        inserted = cur.execute("select count(*) from _new_items").fetchone()[0] - updated

        cur.execute("drop index if exists idx_item_name")
        cur.execute("drop index if exists idx_item_id")
        cur.execute("drop index if exists idx_item_meta")
        cur.execute("drop table if exists item_panel_merged")
        cur.execute("""
            create table item_panel_merged as
            select o.id, o.item_name, o.item_id, o.item_meta, o.has_nbt, o.dname, o.icon
            from item_panel o
            where not exists (select 1 from _new_items n
                              where n.item_name = o.item_name and n.item_meta = o.item_meta)
        """)
        cur.execute("""
            insert into item_panel_merged (item_name, item_id, item_meta, has_nbt, dname, icon)
            select item_name, item_id, item_meta, has_nbt, dname, icon from _new_items
        """)
        cur.execute("drop table item_panel")
        cur.execute("alter table item_panel_merged rename to item_panel")
        cur.execute("drop table _new_items")
        cur.execute("create index idx_item_name on item_panel(item_name)")
        cur.execute("create index idx_item_id on item_panel(item_id)")
        cur.execute("create index idx_item_meta on item_panel(item_meta)")
        db.commit()
        db.execute("vacuum")
        cur = db.cursor()

        if os.path.isfile(fluidCsv):
            cur.execute("delete from fluid_container")
            cur.executemany("insert into fluid_container values(:id, :fluid_name, :item, :meta, :dname, :amount)", loadFluids(fluidCsv))
            db.commit()
            fluidNote = "已重建"
        else:
            fluidNote = "缺 csv，保留底库原有数据"
        fluids = cur.execute("select count(*) from fluid_container").fetchone()[0]
        after = cur.execute("select count(*) from item_panel").fetchone()[0]
        print("合并结果：覆盖 %d 行，新增 %d 行，保留旧图 %d 行" % (updated, inserted, kept))
        print("item_panel: %d → %d 行；fluid_container: %d 行（%s）" % (before, after, fluids, fluidNote))
    else:
        # ---- 重建模式：全新数据库 ----
        db = sqlite3.connect(DB_OUT)
        cur = db.cursor()
        createSchema(cur)
        cur.executemany("insert into item_panel values(:id, :item_name, :item_id, :item_meta, :has_nbt, :dname, :icon)", rows)
        cur.executemany("insert into fluid_container values(:id, :fluid_name, :item, :meta, :dname, :amount)", loadFluids(fluidCsv))
        db.commit()
        fluids = cur.execute("select count(*) from fluid_container").fetchone()[0]
        print("item_panel: %d 行；fluid_container: %d 行" % (total, fluids))
        if total < 20000:
            print("[警告] 物品面板只有 %d 条，明显少于完整导出（GTNH 全量约 5 万条）；"
                  "请确认导出时 NEI 物品列表已加载完毕、没有搜索过滤；"
                  "若新版本面板确实只给这么多，用 --merge 保留旧库覆盖更稳妥" % total)

    db.close()
    print("完成 → %s（%.1f MB），确认无误后覆盖到 assets/itempanel.db"
          % (DB_OUT, os.path.getsize(DB_OUT) / 1048576))


main()
