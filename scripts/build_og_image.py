#!/usr/bin/env python3
"""Render the Open Graph card.

Same three colours and the same figures as the tool, so a shared link looks
like the page it opens.
"""
import sys
from pathlib import Path

sys.path.insert(0, "/private/tmp/claude-501/-Users-nevanleo/"
                   "d60d053c-17c1-4af9-848a-7523f0000000/scratchpad/pylibs")
sys.path.insert(0, "/private/tmp/claude-501/-Users-nevanleo/"
                   "d60d053c-17c1-4af9-848a-7825f144baac/scratchpad/pylibs")
from PIL import Image, ImageDraw, ImageFont  # noqa: E402

W, H = 1200, 630
PAPER, INK, INK3, RED, LINE = "#ffffff", "#111111", "#6b6b6b", "#c8102e", "#e4e4e1"
BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
REG = "/System/Library/Fonts/Supplemental/Arial.ttf"
font = lambda path, size: ImageFont.truetype(path, size)

card = Image.new("RGB", (W, H), PAPER)
draw = ImageDraw.Draw(card)

M = 72                                  # one margin, used everywhere
draw.rectangle([0, 0, W, 8], fill=RED)  # the only flourish

draw.rectangle([M, M + 24, M + 44, M + 68], fill=RED)
draw.text((M + 58, M + 30), "NorthByte", font=font(BOLD, 26), fill=INK)
draw.text((M + 58, M + 62), "PROFIT SCENARIO TOOL", font=font(REG, 14), fill=INK3)

draw.text((M, 228), "What does it take", font=font(BOLD, 72), fill=INK)
draw.text((M, 306), "to stop losing money?", font=font(BOLD, 72), fill=INK)

draw.line([M, 422, W - M, 422], fill=LINE, width=1)

stats = [("FY25-26 PROFIT AFTER GATES", "−$58.8M", RED),
         ("FLIGHTS", "15,729", INK),
         ("ROUTES", "54", INK),
         ("RECOMMENDED PLAN", "−$0.8M", INK)]
x = M
for label, value, colour in stats:
    draw.text((x, 454), label, font=font(REG, 13), fill=INK3)
    draw.text((x, 480), value, font=font(BOLD, 40), fill=colour)
    x += 268

draw.text((M, H - M - 2), "BOLT UBC First Byte 2026  ·  Move the levers, watch profit move",
          font=font(REG, 16), fill=INK3)

out = Path(__file__).resolve().parent.parent / "public" / "og.png"
card.save(out, "PNG")
print(f"{out}: {W}x{H}, {out.stat().st_size // 1024} KB")
