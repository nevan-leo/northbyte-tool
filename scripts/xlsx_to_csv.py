#!/usr/bin/env python3
"""Convert the FirstByte case workbooks to CSV once, so the rest of the pipeline
never pays the cost of parsing 32 MB of XML again.

    scripts/xlsx_to_csv.py <in.xlsx> <out.csv>
"""
import csv
import sys

sys.path.insert(0, "/private/tmp/claude-501/-Users-nevanleo/"
                   "d60d053c-17c1-4af9-848a-7825f144baac/scratchpad/pylibs")
import openpyxl  # noqa: E402

source, target = sys.argv[1], sys.argv[2]
book = openpyxl.load_workbook(source, read_only=True, data_only=True)
sheet = book.worksheets[0]

rows = sheet.iter_rows(values_only=True)
header = [str(c).strip() for c in next(rows) if c is not None]
width = len(header)

written = 0
with open(target, "w", newline="") as fh:
    writer = csv.writer(fh)
    writer.writerow(header)
    for row in rows:
        values = list(row[:width])
        if all(v is None or str(v).strip() == "" for v in values):
            continue            # trailing blank rows from the export
        writer.writerow(["" if v is None else str(v).strip() for v in values])
        written += 1
book.close()
print(f"{target}: {written:,} rows, columns = {', '.join(header)}")
