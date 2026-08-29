#!/usr/bin/env python3
"""
アプリのアイコン一式を作り直す。

使い方:
  1. 元にしたい画像を assets/app-icon.png（.jpg / .jpeg / .webp でも可）として置く
  2. python3 tools/make-icons.py

正方形でない画像は中央で正方形に切り出す。
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
    w, h = im.size
    s = min(w, h)
    left, top = (w - s) // 2, (h - s) // 2
    return im.crop((left, top, left + s, top + s))


def corner_color(im):
    """四隅の平均色。maskable の余白に使う"""
    px = im.convert('RGB')
    w, h = px.size
    pts = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    cols = [px.getpixel(p) for p in pts]
    return tuple(sum(c[i] for c in cols) // len(cols) for i in range(3))


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

    bg = corner_color(im)
    canvas = Image.new('RGB', (512, 512), bg)
    inner = im.resize((400, 400), Image.LANCZOS)
    canvas.paste(inner, (56, 56))
    canvas.save(os.path.join(ASSETS, 'icon-maskable-512.png'), 'PNG', optimize=True)
    print('  -> icon-maskable-512.png 512（余白の色 %s）' % (bg,))
    print('できました。ブラウザのキャッシュが残る場合はホーム画面から削除して追加し直してください。')


if __name__ == '__main__':
    main()
