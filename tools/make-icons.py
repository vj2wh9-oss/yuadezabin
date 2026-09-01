#!/usr/bin/env python3
"""
アプリのアイコン一式を作り直す。

使い方:
  1. 元にしたい画像を assets/app-icon.png（.jpg / .jpeg / .webp でも可）として置く
  2. python3 tools/make-icons.py

正方形でない画像は正方形に切り出す（縦長のときは上を残す）。
maskable 用は Android の安全領域に収まるよう少し縮めて、四隅から拾った色で余白を埋める。
"""
import os
import sys

try:
    from PIL import Image
except ImportError:
    print('Pillow が必要です:  pip install pillow')
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'assets')

SIZES = [
    (180, 'icon-180.png'),   # iPhone のホーム画面用（apple-touch-icon）
    (192, 'icon-192.png'),   # PWA
    (512, 'icon-512.png'),   # PWA
    (64, 'favicon-64.png'),  # ブラウザのタブ
]


def find_source():
    for ext in ('png', 'jpg', 'jpeg', 'webp', 'PNG', 'JPG', 'JPEG', 'WEBP'):
        path = os.path.join(ASSETS, 'app-icon.' + ext)
        if os.path.exists(path):
            return path
    return None


def to_square(im):
    """正方形に切り出す。
    縦長の絵は顔が上にあることが多いので、中央ではなく上を残す
    （中央で切ると髪の先が欠けてしまう）。"""
    w, h = im.size
    s = min(w, h)
    left = (w - s) // 2
    top = 0 if h > w else (h - s) // 2
    return im.crop((left, top, left + s, top + s))


def edge_color(im):
    """縁でいちばん多い色。maskable の余白に使う。
    四隅の平均だと、下が服・上が背景のような絵で濁った色になってしまう。"""
    px = im.convert('RGB')
    w, h = px.size
    pts = []
    for i in range(24):
        x = int((w - 1) * i / 23)
        y = int((h - 1) * i / 23)
        pts += [(x, 0), (x, h - 1), (0, y), (w - 1, y)]
    counts = {}
    for p in pts:
        c = px.getpixel(p)
        c = (c[0] // 8 * 8, c[1] // 8 * 8, c[2] // 8 * 8)   # 少しの差は同じ色とみなす
        counts[c] = counts.get(c, 0) + 1
    return max(counts.items(), key=lambda kv: kv[1])[0]


def main():
    src = find_source()
    if not src:
        print('assets/app-icon.png が見つかりません。元画像を置いてから実行してください。')
        sys.exit(1)

    im = to_square(Image.open(src).convert('RGB'))
    print('元画像:', os.path.basename(src), im.size)

    for size, name in SIZES:
        im.resize((size, size), Image.LANCZOS).save(
            os.path.join(ASSETS, name), 'PNG', optimize=True)
        print('  ->', name, size)

    bg = edge_color(im)
    canvas = Image.new('RGB', (512, 512), bg)
    inner = im.resize((400, 400), Image.LANCZOS)
    canvas.paste(inner, (56, 56))
    canvas.save(os.path.join(ASSETS, 'icon-maskable-512.png'), 'PNG', optimize=True)
    print('  -> icon-maskable-512.png 512（余白の色 %s）' % (bg,))
    print('できました。ブラウザのキャッシュが残る場合はホーム画面から削除して追加し直してください。')


if __name__ == '__main__':
    main()
