#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成云团子 PWA 图标：any + maskable，192/512 共 4 张。
直接用 Pillow 画，保证和 app 里的云团子形象一致（云朵身 + 粉脸颊 + 眼睛 + 微笑）。"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(OUT, exist_ok=True)

# 主题色（取自 style.css :root）
BG_TOP = (254, 249, 243)      # --c-bg-day-1
BG_BOT = (234, 246, 251)     # #eaf6fb
CLOUD = (255, 255, 255)
CLOUD_EDGE = (240, 230, 216)
CLOUD_PINK = (255, 240, 243)
CHEEK = (255, 179, 179)
EYE = (74, 74, 92)            # --c-text
HIGHLIGHT = (255, 255, 255)


def vgradient(size, top, bottom):
    """竖直线性渐变背景。"""
    w, h = size
    base = Image.new("RGB", size, top)
    px = base.load()
    for y in range(h):
        t = y / max(h - 1, 1)
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        for x in range(w):
            px[x, y] = (r, g, b)
    return base


def blob(d, cx, cy, r, fill, edge=None):
    """画一个云朵凸起（带淡淡的下边描边模拟体积）。"""
    if edge:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=edge)
        d.ellipse([cx - r + 1, cy - r + 1, cx + r - 1, cy + r - 2], fill=fill)
    else:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)


def draw_cloud(d, cx, cy, s):
    """以 (cx, cy) 为云朵中心、s 为整体缩放画云团子。"""
    def P(x, y):
        return (cx + x * s, cy + y * s)

    # 云朵身：几个重叠的圆构成蓬松形状
    # 下边描边给一点体积感
    blob(d, *P(0, 28), 52 * s, CLOUD, edge=CLOUD_EDGE)      # 底座
    blob(d, *P(-44, 12), 40 * s, CLOUD, edge=CLOUD_EDGE)    # 左下
    blob(d, *P(44, 12), 40 * s, CLOUD, edge=CLOUD_EDGE)     # 右下
    blob(d, *P(-70, -6), 34 * s, CLOUD)                     # 左侧
    blob(d, *P(70, -6), 34 * s, CLOUD)                      # 右侧
    blob(d, *P(-26, -28), 42 * s, CLOUD_PINK)               # 顶左（带粉）
    blob(d, *P(26, -28), 42 * s, CLOUD_PINK)                # 顶右（带粉）
    blob(d, *P(0, -40), 46 * s, CLOUD)                      # 顶
    # 中央收口让脸更干净
    blob(d, *P(0, 6), 60 * s, CLOUD)

    # 脸颊
    blob(d, *P(-30, 4), 12 * s, CHEEK)
    blob(d, *P(30, 4), 12 * s, CHEEK)

    # 眼睛：深色圆 + 小白点高光
    er = 7 * s
    for ex in (-14, 14):
        d.ellipse([ex * s - er + cx, -6 * s - er + cy,
                   ex * s + er + cx, -6 * s + er + cy], fill=EYE)
        hr = 2.4 * s
        d.ellipse([ex * s - er + 1.5 * s - hr + cx, -6 * s - er + 1.5 * s - hr + cy,
                   ex * s - er + 1.5 * s + hr + cx, -6 * s - er + 1.5 * s + hr + cy],
                  fill=HIGHLIGHT)

    # 微笑（一段弧）
    arc_box = [cx - 14 * s, cy + 6 * s, cx + 14 * s, cy + 22 * s]
    d.arc(arc_box, start=10, end=170, fill=EYE, width=max(2, int(3 * s)))


def make(size, maskable):
    img = vgradient((size, size), BG_TOP, BG_BOT).convert("RGBA")
    d = ImageDraw.Draw(img)
    # maskable 需要把内容收进中心 80% 安全区，背景填满
    scale = size / 512.0
    if maskable:
        scale *= 0.78                      # 内容缩小留安全边
        # 额外补一层柔光晕，避免 maskable 切圆后背景太空
        halo = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        hd = ImageDraw.Draw(halo)
        hd.ellipse([size * 0.18, size * 0.18, size * 0.82, size * 0.82],
                   fill=(255, 220, 230, 40))
        img = Image.alpha_composite(img, halo)
        d = ImageDraw.Draw(img)
    draw_cloud(d, size / 2, size * 0.50, scale)
    return img


for size in (192, 512):
    for maskable in (False, True):
        img = make(size, maskable)
        name = ("icon" if not maskable else "maskable") + f"-{size}.png"
        img.save(os.path.join(OUT, name), "PNG", optimize=True)
        print("saved", name, img.size)

# 顺便生成一个 favicon 用的 32 + 180(apple-touch 需要至少这么大会被用，这里给 180)
make(180, False).save(os.path.join(OUT, "apple-touch-icon.png"), "PNG", optimize=True)
# favicon 按惯例放站点根目录（浏览器会默认请求 /favicon.ico、/favicon-32.png）
ROOT = os.path.join(os.path.dirname(__file__), "..")
make(32, False).save(os.path.join(ROOT, "favicon-32.png"), "PNG", optimize=True)
print("done")
