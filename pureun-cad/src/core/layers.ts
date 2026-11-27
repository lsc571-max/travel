// 레이어 관리 (생성, 이름 변경, 삭제, 색상, 켜기/끄기, 잠금) — 모두 실행취소 가능
import type { Drawing } from './document';
import type { Layer } from './types';

const INVALID = /[<>/\\":;?*|=`]/;

export function validLayerName(doc: Drawing, name: string, except?: string): string | null {
  const n = name.trim();
  if (!n) return '레이어 이름을 입력하십시오.';
  if (n.length > 255) return '레이어 이름이 너무 깁니다.';
  if (INVALID.test(n)) return '레이어 이름에 다음 문자를 쓸 수 없습니다: < > / \\ " : ; ? * | = `';
  for (const l of doc.layers.keys()) if (l.toUpperCase() === n.toUpperCase() && l !== except) return '같은 이름의 레이어가 이미 있습니다.';
  return null;
}

export function addLayer(doc: Drawing, name: string, color = 7): string | null {
  const err = validLayerName(doc, name);
  if (err) return err;
  const tx = doc.tx('레이어 생성');
  tx.setLayers([...doc.layers.values(), { name: name.trim(), color, on: true, locked: false }], doc.currentLayer);
  tx.commit();
  return null;
}

export function setLayerProps(doc: Drawing, name: string, patch: Partial<Omit<Layer, 'name'>>): string | null {
  if (patch.on === false && name === doc.currentLayer) {
    // AutoCAD도 현재 레이어 끄기는 허용(경고). 여기서는 허용하되 알림만.
  }
  const tx = doc.tx('레이어 속성');
  tx.setLayers(
    [...doc.layers.values()].map((l) => (l.name === name ? { ...l, ...patch, frozen: patch.on === true ? false : l.frozen } : l)),
    doc.currentLayer,
  );
  tx.commit();
  return null;
}

export function renameLayer(doc: Drawing, oldName: string, newName: string): string | null {
  if (oldName === '0') return '레이어 "0"은 이름을 바꿀 수 없습니다.';
  const nn = newName.trim();
  if (nn === oldName) return null;
  const err = validLayerName(doc, nn, oldName);
  if (err) return err;
  const tx = doc.tx('레이어 이름 변경');
  for (const e of doc.entities.values()) if (e.layer === oldName) tx.update({ ...e, layer: nn }, { allowLocked: true });
  if (doc.preserved.some((p) => p.layer === oldName)) {
    tx.setPreserved(
      doc.preserved.map((p) =>
        p.layer === oldName
          ? {
              ...p,
              layer: nn,
              pairs: p.pairs.map((q) => (q.code === 8 && q.value === oldName ? { ...q, value: nn } : q)),
              display: p.display?.map((d) => (d.layer === oldName ? { ...d, layer: nn } : d)),
            }
          : p,
      ),
    );
  }
  tx.setLayers(
    [...doc.layers.values()].map((l) => (l.name === oldName ? { ...l, name: nn } : l)),
    doc.currentLayer === oldName ? nn : doc.currentLayer,
  );
  tx.commit();
  return null;
}

export function deleteLayer(doc: Drawing, name: string): string | null {
  if (name === '0') return '레이어 "0"은 삭제할 수 없습니다.';
  if (name === doc.currentLayer) return '현재 레이어는 삭제할 수 없습니다. 다른 레이어를 현재 레이어로 지정한 뒤 삭제하십시오.';
  const n = doc.layerUsage().get(name) ?? 0;
  if (n > 0) return `이 레이어에 객체 ${n}개가 있어 삭제할 수 없습니다. 객체를 다른 레이어로 옮기거나 지운 뒤 삭제하십시오.`;
  for (const b of doc.preservedBlocks) if (b.pairs.some((p) => p.code === 8 && p.value === name)) return '블록 정의에서 사용 중인 레이어입니다.';
  const tx = doc.tx('레이어 삭제');
  tx.setLayers(
    [...doc.layers.values()].filter((l) => l.name !== name),
    doc.currentLayer,
  );
  tx.commit();
  return null;
}
