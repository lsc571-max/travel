"""DXF 파일 독립 검증 (ezdxf, MIT 라이선스 — 개발용 도구로만 사용, 제품에 포함하지 않음)
사용: python3 audit_dxf.py 파일.dxf
"""
import sys

import ezdxf
from ezdxf import recover

path = sys.argv[1]
try:
    doc = ezdxf.readfile(path)
except Exception as e:  # 엄격 모드 실패 시 복구 모드로 원인 확인
    print("READ FAIL (strict):", e)
    doc, auditor = recover.readfile(path)
    for err in auditor.errors:
        print("ERR", err.code, err.message)
    sys.exit(1)

auditor = doc.audit()
msp = doc.modelspace()
counts = {}
for e in msp:
    counts[e.dxftype()] = counts.get(e.dxftype(), 0) + 1
print("version", doc.dxfversion, "entities", counts)
for err in auditor.errors:
    print("ERR", err.code, err.message)
for fix in auditor.fixes:
    print("FIX", fix.code, fix.message)
# 치수 블록 존재 확인
for d in msp.query("DIMENSION"):
    name = d.dxf.geometry
    if name not in doc.blocks:
        print("ERR missing dimension block", name)
        sys.exit(1)
if auditor.has_errors:
    sys.exit(1)
print("AUDIT OK (errors=0, fixes=%d)" % len(auditor.fixes))
