# 从内置 itempanel.db 抽样生成 mock 数据（物品池 + 流体池），
# 保证 mock 服务器下发的 item_name/meta 都能命中本地 db 的图标与名称。
import sqlite3
import json
import random
import base64
import io
import os

random.seed(2026)

DB = os.path.join(os.path.dirname(__file__), "..", "assets", "itempanel.db")
OUT = os.path.join(os.path.dirname(__file__), "data.json")

con = sqlite3.connect(DB)
cur = con.cursor()

# 物品池：有图标的物品
rows = cur.execute(
    "select item_name, item_meta from item_panel where icon is not null and has_nbt='false' order by random() limit 900"
).fetchall()
items = [{"name": r[0], "meta": int(r[1])} for r in rows]

# 带 NBT 的物品（模拟 nbt 寻址路径）
nbt_rows = cur.execute(
    "select item_name, item_meta from item_panel where has_nbt='true' and icon is not null order by random() limit 40"
).fetchall()
nbt_items = [{"name": r[0], "meta": int(r[1])} for r in nbt_rows]

# 流体池：fluid_container join item_panel，与 App 的查询一致
fluid_rows = cur.execute(
    """select fc.fluid_name, fc.item, fc.meta, fc.amount, fc.container_display_name
       from fluid_container fc join item_panel ip
       on fc.item = ip.item_name and fc.meta = ip.item_meta limit 80"""
).fetchall()
fluids = [
    {
        "fluid": r[0],
        "container_item": r[1],
        "container_meta": int(r[2]),
        "amount": int(r[3]),
        "dname": r[4],
    }
    for r in fluid_rows
]


def make_fluid_nbt(fluid_name: str) -> str:
    # 根复合标签（未命名）+ TAG_String "Fluid" = <流体名>，匹配 parsenbt-js 的 comp>/str> 结构
    buf = io.BytesIO()
    buf.write(b"\x0a\x00\x00")  # TAG_Compound, 空名
    name = b"Fluid"
    val = fluid_name.encode("utf-8")
    buf.write(b"\x08")
    buf.write(len(name).to_bytes(2, "big"))
    buf.write(name)
    buf.write(len(val).to_bytes(2, "big"))
    buf.write(val)
    buf.write(b"\x00")  # TAG_End
    return base64.b64encode(buf.getvalue()).decode("ascii")


for f in fluids:
    f["nbt"] = make_fluid_nbt(f["fluid"])

with open(OUT, "w", encoding="utf-8") as fp:
    json.dump({"items": items, "nbt_items": nbt_items, "fluids": fluids}, fp, ensure_ascii=False)

print(f"items={len(items)} nbt_items={len(nbt_items)} fluids={len(fluids)} -> {OUT}")
