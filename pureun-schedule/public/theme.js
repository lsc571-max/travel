// 화면 깜빡임 방지: 저장된 테마·글자 크기를 화면 그리기 전에 먼저 적용
try {
  var s = JSON.parse(localStorage.getItem('pc.settings') || '{}');
  if (s.theme && s.theme !== 'system') document.documentElement.dataset.theme = s.theme;
  if (s.fontSize) document.documentElement.dataset.font = s.fontSize;
} catch (e) { /* 저장소 사용 불가 시 기본값 */ }
