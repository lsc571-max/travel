"""실무형 시험 도면 생성 (ezdxf 1.4, MIT — 개발용 독립 도구. 제품에는 포함하지 않음)
푸른캐드와 무관한 독립 구현으로 만든 DXF를 읽어 호환성을 교차 검증한다.
사용: python3 make_fixtures.py  → tests/fixtures/*.dxf 생성
"""
import math
import os

import ezdxf
from ezdxf.enums import TextEntityAlignment

HERE = os.path.dirname(os.path.abspath(__file__))


def flange(doc):
    """플랜지: 외경 Ø200, 내경 Ø80, PCD 150 위 볼트 구멍 8-Ø14, 키홈, 중심선"""
    msp = doc.modelspace()
    doc.layers.add("외형선", color=7)
    doc.layers.add("중심선", color=1, linetype="CENTER")
    doc.layers.add("치수", color=3)
    doc.layers.add("잠금", color=5).lock()
    off = doc.layers.add("숨김", color=6)
    off.off()
    msp.add_circle((0, 0), 100, dxfattribs={"layer": "외형선"})
    msp.add_circle((0, 0), 40, dxfattribs={"layer": "외형선"})
    for i in range(8):
        a = math.radians(i * 45 + 22.5)
        msp.add_circle((75 * math.cos(a), 75 * math.sin(a)), 7, dxfattribs={"layer": "외형선"})
    msp.add_circle((0, 0), 75, dxfattribs={"layer": "중심선"})
    msp.add_line((-110, 0), (110, 0), dxfattribs={"layer": "중심선"})
    msp.add_line((0, -110), (0, 110), dxfattribs={"layer": "중심선"})
    # 슬롯(장공): 반원 bulge 폴리선
    if doc.dxfversion > "AC1009":
        msp.add_lwpolyline([(-20, 55, 0, 0, 0), (20, 55, 0, 0, 1), (20, 65, 0, 0, 0), (-20, 65, 0, 0, 1)], format="xyseb", close=True, dxfattribs={"layer": "외형선"})
    else:
        msp.add_polyline2d([(-20, 55), (20, 55), (20, 65), (-20, 65)], close=True, dxfattribs={"layer": "외형선"})
        pl = msp.query("POLYLINE")[0]
        v = list(pl.vertices)
        v[1].dxf.bulge = 1
        v[3].dxf.bulge = 1
    msp.add_arc((0, 0), 90, 200, 340, dxfattribs={"layer": "외형선"})
    msp.add_line((0, 0), (5, 5), dxfattribs={"layer": "잠금"})
    msp.add_line((0, 0), (-5, 5), dxfattribs={"layer": "숨김"})
    t = msp.add_text("플랜지 8-%%c14 PCD150", dxfattribs={"layer": "치수", "height": 5})
    t.set_placement((-60, -130), align=TextEntityAlignment.LEFT)
    dim = msp.add_linear_dim(base=(0, -120), p1=(-100, 0), p2=(100, 0), dxfattribs={"layer": "치수"})
    dim.render()
    dim = msp.add_diameter_dim(center=(0, 0), radius=40, angle=45, dxfattribs={"layer": "치수"})
    dim.render()
    dim = msp.add_radius_dim(center=(0, 0), radius=100, angle=135, dxfattribs={"layer": "치수"})
    dim.render()


def extras(doc):
    """미지원 객체: SPLINE, ELLIPSE, MTEXT, 블록 참조(INSERT), 반전된 호(OCS -Z), 각도 치수"""
    msp = doc.modelspace()
    blk = doc.blocks.new("BOLT_M10")
    blk.add_circle((0, 0), 5)
    blk.add_line((-7, 0), (7, 0))
    blk.add_line((0, -7), (0, 7))
    msp.add_blockref("BOLT_M10", (150, 0), dxfattribs={"rotation": 30, "xscale": 1, "yscale": 1})
    msp.add_blockref("BOLT_M10", (180, 0), dxfattribs={"xscale": 2, "yscale": 2})
    msp.add_spline([(130, 50), (150, 80), (170, 40), (190, 70)])
    msp.add_ellipse((160, -60), major_axis=(20, 0), ratio=0.5)
    msp.add_mtext("표제란\\P재질: SM45C", dxfattribs={"char_height": 4, "insert": (130, -100)})
    # 아래쪽(-Z) 돌출 방향의 호 (CAM에서 흔한 반전 호)
    msp.add_arc((-150, 0), 20, 0, 90, dxfattribs={"extrusion": (0, 0, -1)})
    d = msp.add_angular_dim_2l(base=(220, 40), line1=((200, 0), (240, 0)), line2=((200, 0), (230, 30)))
    d.render()


def main():
    for ver in ["R12", "R2000", "R2010", "R2018"]:
        doc = ezdxf.new(ver, setup=True)
        doc.header["$INSUNITS"] = 4 if ver != "R12" else 0
        flange(doc)
        if ver != "R12":
            extras(doc)
        if ver == "R12":
            # 한국어 AutoCAD 저장 파일과 같은 형태: 코드페이지 ANSI_949 + CP949 바이트
            doc.header["$DWGCODEPAGE"] = "ANSI_949"
        # R2000: 머리글은 ANSI_1252인데 실제 바이트는 CP949인 (잘못 저장된) 파일 사례
        name = os.path.join(HERE, f"flange_{ver}.dxf")
        doc.saveas(name, encoding="cp949" if ver in ("R12", "R2000") else "utf8")
        print("written", name)


if __name__ == "__main__":
    main()
