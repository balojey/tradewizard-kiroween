#!/usr/bin/env python3
"""Render the Warden YouTube thumbnail (1280x720).

Run from the repository root: python3 docs/warden-thumbnail.py

Brand source: tradewizard-admin/app/icon.svg (ink tile, one live blue row).
Palette from the same file, so the thumbnail and the app mark agree.
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1280, 720

INK_TOP = (10, 13, 18)
INK_BOTTOM = (18, 22, 29)
INK = "#0E1116"
PANEL = (21, 26, 33)
BORDER = "#2E333B"
BLUE = "#3480FC"
BLUE_SOFT = "#5B9BFF"
GRAY = "#43484F"
WHITE = "#F5F7FA"
MUTED = "#8B93A1"
DIM = "#5A6270"
GREEN = "#2FBF71"

SANS = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
SANS_REG = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
SANS_NARROW = "/usr/share/fonts/truetype/liberation/LiberationSansNarrow-Bold.ttf"
MONO = "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf"
MONO_BOLD = "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf"

font = lambda path, size: ImageFont.truetype(path, size)


def rounded(draw, box, radius, fill=None, outline=None, width=1):
    """Pillow 8 has no rounded_rectangle: build one from rects and pieslices."""
    x0, y0, x1, y1 = box
    r = min(radius, (x1 - x0) // 2, (y1 - y0) // 2)
    if fill:
        draw.rectangle((x0 + r, y0, x1 - r, y1), fill=fill)
        draw.rectangle((x0, y0 + r, x1, y1 - r), fill=fill)
        draw.pieslice((x0, y0, x0 + 2 * r, y0 + 2 * r), 180, 270, fill=fill)
        draw.pieslice((x1 - 2 * r, y0, x1, y0 + 2 * r), 270, 360, fill=fill)
        draw.pieslice((x0, y1 - 2 * r, x0 + 2 * r, y1), 90, 180, fill=fill)
        draw.pieslice((x1 - 2 * r, y1 - 2 * r, x1, y1), 0, 90, fill=fill)
    if outline:
        draw.arc((x0, y0, x0 + 2 * r, y0 + 2 * r), 180, 270, fill=outline, width=width)
        draw.arc((x1 - 2 * r, y0, x1, y0 + 2 * r), 270, 360, fill=outline, width=width)
        draw.arc((x0, y1 - 2 * r, x0 + 2 * r, y1), 90, 180, fill=outline, width=width)
        draw.arc((x1 - 2 * r, y1 - 2 * r, x1, y1), 0, 90, fill=outline, width=width)
        draw.line((x0 + r, y0, x1 - r, y0), fill=outline, width=width)
        draw.line((x0 + r, y1, x1 - r, y1), fill=outline, width=width)
        draw.line((x0, y0 + r, x0, y1 - r), fill=outline, width=width)
        draw.line((x1, y0 + r, x1, y1 - r), fill=outline, width=width)


def tracked(draw, xy, text, fnt, fill, tracking=0):
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += draw.textlength(ch, font=fnt) + tracking
    return x


# ── Background ────────────────────────────────────────────────────────────────
img = Image.new("RGB", (W, H), INK_TOP)
d = ImageDraw.Draw(img)

for y in range(H):
    t = y / (H - 1)
    d.line(
        (0, y, W, y),
        fill=tuple(round(INK_TOP[i] + (INK_BOTTOM[i] - INK_TOP[i]) * t) for i in range(3)),
    )

# Grid: faint structural lines, stronger every fourth.
for x in range(0, W, 64):
    d.line((x, 0, x, H), fill=(26, 31, 39) if x % 256 else (33, 39, 48), width=1)
for y in range(0, H, 64):
    d.line((0, y, W, y), fill=(26, 31, 39) if y % 256 else (33, 39, 48), width=1)

# Glow behind the mark.
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
for radius, alpha in ((360, 26), (300, 34), (240, 40)):
    gd.ellipse((960 - radius, 360 - radius, 960 + radius, 360 + radius), fill=(52, 128, 252, alpha))
glow = glow.filter(ImageFilter.GaussianBlur(70))
img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")
d = ImageDraw.Draw(img)

# ── Left side ─────────────────────────────────────────────────────────────────
X = 80

# Accent rule + eyebrow.
d.rectangle((X, 92, X + 44, 100), fill=BLUE)
end = tracked(d, (X + 64, 82), "TRADEWIZARD", font(MONO_BOLD, 22), BLUE_SOFT, tracking=2.0)
tracked(d, (end + 10, 82), "·  KIROWEEN 2026", font(MONO_BOLD, 22), MUTED, tracking=1.2)

# Headline, auto-fitted to the column left of the mark.
TILE = 344
tx, ty = 872, 156
max_width = tx - 48 - X
size = 172
while size > 90:
    headline = font(SANS, size)
    if d.textlength("WARDEN", font=headline) <= max_width:
        break
    size -= 2
d.text((X - 6, 128), "WARDEN", font=headline, fill=WHITE)

# Subhead, two lines so it stays readable at 320x180.
sub = font(SANS_REG, 50)
d.text((X, 348), "The audited control plane", font=sub, fill=(206, 214, 224))
d.text((X, 408), "for a live trading system", font=sub, fill=(206, 214, 224))

# Chips.
chips = [
    ("HASH-CHAINED AUDIT", 300),
    ("4 ROLES", 150),
    ("KILL SWITCH", 205),
]
cx = X
cy = 508
chip_font = font(MONO_BOLD, 20)
for label, width in chips:
    rounded(d, (cx, cy, cx + width, cy + 52), 10, fill=(20, 25, 32), outline=(48, 55, 66), width=2)
    text_w = d.textlength(label, font=chip_font)
    d.text((cx + (width - text_w) / 2, cy + 15), label, font=chip_font, fill=(190, 199, 210))
    cx += width + 18

# URL.
d.text((X, 620), "warden.tradewizard.live", font=font(MONO, 26), fill=BLUE_SOFT)

# ── Right side: the app mark, enlarged ───────────────────────────────────────
rounded(d, (tx, ty, tx + TILE, ty + TILE), 64, fill=INK)
rounded(d, (tx, ty, tx + TILE, ty + TILE), 64, outline=BORDER, width=3)

scale = TILE / 64
bars = [(17, BLUE), (29, GRAY), (41, GRAY)]
for offset, colour in bars:
    bx = tx + 15 * scale
    by = ty + offset * scale
    bw = 34 * scale
    bh = 7 * scale
    rounded(d, (bx, by, bx + bw, by + bh), bh / 2, fill=colour)

# Verified caption under the tile.
dot = (tx + 6, ty + TILE + 46)
d.ellipse((dot[0], dot[1], dot[0] + 16, dot[1] + 16), fill=GREEN)
tracked(
    d,
    (dot[0] + 28, dot[1] - 3),
    "AUDIT CHAIN VERIFIED",
    font(MONO_BOLD, 22),
    (200, 230, 212),
    tracking=1.0,
)
d.text(
    (tx + 6, ty + TILE + 82),
    "every mutation leaves a hash",
    font=font(MONO, 19),
    fill=DIM,
)

# ── Bottom rule ──────────────────────────────────────────────────────────────
d.rectangle((0, H - 10, W, H), fill=BLUE)

img.save("docs/warden-thumbnail.png", optimize=True)
print("saved docs/warden-thumbnail.png", img.size)
