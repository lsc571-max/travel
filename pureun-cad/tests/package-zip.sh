#!/usr/bin/env bash
# 배포·백업용 ZIP 생성 (비밀정보·의존성·산출물 제외). 사용: bash tests/package-zip.sh V0
set -euo pipefail
VER="${1:-V0}"
cd "$(dirname "$0")/.."
OUT="${2:-.}"
npm run build >/dev/null
git ls-files . > /tmp/pureun-files.txt 2>/dev/null || find . -type f -not -path './node_modules/*' -not -path './dist/*' > /tmp/pureun-files.txt
zip -q -r "$OUT/pureun-cad-$VER-source.zip" -@ < /tmp/pureun-files.txt
(cd dist && zip -q -r "../$OUT/pureun-cad-$VER-web.zip" .)
echo "$OUT/pureun-cad-$VER-source.zip $OUT/pureun-cad-$VER-web.zip"
