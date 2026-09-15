#!/usr/bin/env python3
"""Eufy の体重計から体重を読んで、同期サーバー（Worker）へ預けるスクリプト。

なぜ要るのか
    iPhone のブラウザ（Safari）には Web Bluetooth が無いので、
    アプリから体重計へ直接つなぐ道がありません。
    そこで、家に置いた PC やラズパイでこれを動かします。
    体重計に乗る → このスクリプトが読む → Worker に預ける →
    アプリの「筋トレ」タブで「預かっているぶんを取り込む」。

使うもの
    pip install eufylife-ble-client bleak requests

つなぎ方
    1) 体重計の MAC アドレスを調べる
         python3 tools/eufy-weight.py --scan
    2) 環境変数を入れて動かす（合鍵はアプリの設定にあるものと同じ）
         export SHIMEKIRI_URL=https://<あなたの Worker>.workers.dev
         export SHIMEKIRI_TOKEN=<合鍵>
         export EUFY_ADDRESS=XX:XX:XX:XX:XX:XX
         python3 tools/eufy-weight.py --watch
    3) 体重計に乗る。数字が落ち着いたら1件だけ預ける

    ラズパイなら systemd に登録して、ずっと動かしておくのが楽です。

手で入れることもできる（体重計が無い場所から）
    python3 tools/eufy-weight.py --kg 81.4 --date 2026-09-15

注意
    合鍵は環境変数で渡してください。ソースにも、履歴にも書かないこと。
"""

import argparse
import asyncio
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date as _date


def endpoint() -> str:
    url = os.environ.get("SHIMEKIRI_URL", "").rstrip("/")
    if not url:
        sys.exit("SHIMEKIRI_URL が設定されていません")
    return url + "/v1/inbox/weight"


def token() -> str:
    tok = os.environ.get("SHIMEKIRI_TOKEN", "")
    if not tok:
        sys.exit("SHIMEKIRI_TOKEN が設定されていません")
    return tok


def post(items):
    """まとめて預ける。同じ日のぶんは、サーバー側で新しいほうに置き換わる。"""
    body = json.dumps({"items": items}).encode("utf-8")
    req = urllib.request.Request(
        endpoint(),
        data=body,
        headers={
            "authorization": "Bearer " + token(),
            "content-type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            out = json.loads(res.read().decode("utf-8") or "{}")
            print("預けました:", out)
            return True
    except urllib.error.HTTPError as e:
        print("断られました:", e.code, e.read().decode("utf-8", "replace")[:300])
    except Exception as e:  # noqa: BLE001 - 通信まわりは何が来ても止めない
        print("送れませんでした:", e)
    return False


def one(kg, fat=None, muscle=None, when=None):
    return {
        "date": when or _date.today().isoformat(),
        "kg": round(float(kg), 1),
        "fat": round(float(fat), 1) if fat else None,
        "muscle": round(float(muscle), 1) if muscle else None,
    }


# ---------------- Bluetooth ----------------

def need_ble():
    try:
        from eufylife_ble_client import EufyLifeBLEDevice  # noqa: F401
        from bleak import BleakScanner  # noqa: F401
    except ImportError:
        sys.exit(
            "eufylife-ble-client と bleak が要ります:\n"
            "    pip install eufylife-ble-client bleak"
        )


async def scan():
    """近くの体重計を探して、MAC アドレスを出す。"""
    need_ble()
    from bleak import BleakScanner

    print("探しています（10秒）…")
    found = await BleakScanner.discover(timeout=10.0)
    hit = 0
    for d in found:
        name = (d.name or "").strip()
        # Eufy の体重計は T97xx 系の名前で出ることが多い
        if name.lower().startswith("eufy") or name.upper().startswith("T9"):
            print(f"  {d.address}   {name}")
            hit += 1
    if not hit:
        print("見つかりませんでした。体重計に乗って起こしてから、もう一度試してください。")
        print("（見つからないときは、すべての機器を出します）")
        for d in found:
            print(f"  {d.address}   {d.name or '(名前なし)'}")


async def watch(address, model, once=True, stable=3):
    """体重計につないで、数字が落ち着いたら預ける。

    stable 回つづけて同じ値なら「落ち着いた」とみなす。
    """
    need_ble()
    from bleak import BleakScanner
    from eufylife_ble_client import EufyLifeBLEDevice

    dev = EufyLifeBLEDevice(model)
    ble = await BleakScanner.find_device_by_address(address, timeout=20.0)
    if ble is None:
        sys.exit(f"{address} が見つかりませんでした。体重計に乗って起こしてください。")

    seen = {"kg": None, "n": 0, "sent": False}
    loop = asyncio.get_running_loop()
    done = loop.create_future()

    def on_state(state):
        kg = getattr(state, "weight_kg", None)
        if not kg:
            return
        kg = round(float(kg), 1)
        # 乗り始めは数字が動く。同じ値が続いたら本物とみなす
        if seen["kg"] == kg:
            seen["n"] += 1
        else:
            seen["kg"] = kg
            seen["n"] = 1
        print(f"  {kg}kg（{seen['n']}回目）")
        if seen["n"] >= stable and not seen["sent"]:
            seen["sent"] = True
            item = one(kg)
            # 体組成が取れる機種なら添える
            for src, dst in (("body_fat", "fat"), ("muscle_mass_kg", "muscle")):
                v = getattr(state, src, None)
                if v:
                    item[dst] = round(float(v), 1)
            post([item])
            if once and not done.done():
                loop.call_soon_threadsafe(done.set_result, True)

    dev.register_callback(on_state)
    await dev.connect(ble)
    print("つながりました。体重計に乗ってください（Ctrl+C でやめます）")
    try:
        if once:
            await asyncio.wait_for(done, timeout=600)
        else:
            while True:
                await asyncio.sleep(3600)
    except asyncio.TimeoutError:
        print("10分待っても乗られなかったので、やめます")
    finally:
        await dev.disconnect()


def main():
    ap = argparse.ArgumentParser(description="Eufy の体重計から体重を預ける")
    ap.add_argument("--scan", action="store_true", help="近くの体重計を探す")
    ap.add_argument("--watch", action="store_true", help="体重計につないで、乗るのを待つ")
    ap.add_argument("--address", default=os.environ.get("EUFY_ADDRESS", ""),
                    help="体重計の MAC アドレス（環境変数 EUFY_ADDRESS でも可）")
    ap.add_argument("--model", default=os.environ.get("EUFY_MODEL", "T9146"),
                    help="型番（既定 T9146）")
    ap.add_argument("--keep", action="store_true", help="1回で終わらず、乗るたびに預ける")
    ap.add_argument("--kg", type=float, help="手で入れる体重")
    ap.add_argument("--fat", type=float, help="手で入れる体脂肪率")
    ap.add_argument("--muscle", type=float, help="手で入れる筋肉量")
    ap.add_argument("--date", help="日付 YYYY-MM-DD（既定は今日）")
    a = ap.parse_args()

    if a.scan:
        asyncio.run(scan())
        return
    if a.kg:
        post([one(a.kg, a.fat, a.muscle, a.date)])
        return
    if a.watch:
        if not a.address:
            sys.exit("--address か EUFY_ADDRESS が要ります（--scan で調べられます）")
        asyncio.run(watch(a.address, a.model, once=not a.keep))
        return
    ap.print_help()


if __name__ == "__main__":
    main()
