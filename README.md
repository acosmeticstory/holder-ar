# Holder AR

> 스마트폰 카메라로 acosmeticstory Holder 제품의 EAN-13 바코드를 인식해 제품 정보로 연결하는 WebAR 미니 애플리케이션.

**Live**: <https://holders.acosmeticstory.com/>
**Source mirror**: <https://acosmeticstory.github.io/holder-ar/>

---

## 사용 방법

1. 스마트폰 카메라로 위 링크에 접속
2. HTTPS 자체 서명 경고 수락(첫 방문 시) → 카메라 권한 허용
3. 제품 라벨의 바코드(GTIN-13)를 화면 가운데에 맞추기
4. 인식되면 제품 정보 카드가 슬라이드업
5. **다시 스캔** 버튼으로 다음 제품 스캔

---

## 구성

| 파일 | 역할 |
|---|---|
| `index.html` | AR 스캐너 본체. zxing 기반 EAN-13 디코더 + Shopify 제품 정보 fetch |
| `catalog.json` | EAN-13 ↔ Shopify 제품 핸들 매핑 테이블 |
| `tools/sync-shopify-catalog.cjs` | 현재 Shopify Ju·Sai 상품/variant와 바코드 카탈로그 대조·동기화 |
| `labels.html` | 디자이너·QA 용 테스트 라벨(4종) · 인쇄 시 자동으로 실측 20mm |
| `logo.png` | 브랜드 로고 (스캐너 상단 표시) |

---

## 기술 스택

- **바코드 디코딩**: [@zxing/library](https://github.com/zxing-js/library) v0.21.3
- **카메라**: 브라우저 `getUserMedia` (HTTPS 필수)
- **바코드 렌더링**: [JsBarcode](https://github.com/lindell/JsBarcode) (테스트 라벨 페이지)
- **호스팅**: GitHub Pages, 자동 배포 via Actions
- **연결 대상**: [acosmeticstory.com](https://acosmeticstory.com) (Shopify storefront)

라이브러리·런타임 의존성 없음 (단일 HTML 파일 + CDN 스크립트).

---

## 로컬 개발

```bash
# HTTPS 필수 (getUserMedia 요구)
npx http-server . -p 8443 -S -C cert.pem -K key.pem -c-1 -a 0.0.0.0
```

또는 임시 인증서 자동 생성하는 도구:
```bash
npx local-web-server --https --port 8443
```

브라우저에서 `https://localhost:8443/` 접속.

`?debug=1` 파라미터를 붙이면 HUD에 실시간 디코더 카운터 표시.

### Shopify 상품 매칭 확인

`catalog.json`의 EAN은 유지하고, 현재 Shopify의 Ju 상품 및 Sai S/M variant
핸들·링크와 일치하는지 다음 명령으로 확인합니다.

```bash
node tools/sync-shopify-catalog.cjs
```

불일치를 검토한 뒤 카탈로그에 반영할 때만 `--write`를 사용합니다.

```bash
node tools/sync-shopify-catalog.cjs --write
```

---

## 바코드 라벨 사양

| 항목 | 값 |
|---|---|
| 표준 | EAN-13 (= GTIN-13 = JAN-13) |
| 실물 크기 | 20mm 폭 |
| 가드 바 | 평탄 (디센더 없음, MUJI 스타일) |
| 모듈 폭 | 약 0.177mm (20mm ÷ 113 모듈) |
| Quiet zone | 좌·우 각 ≥ 2.5mm |

2026-05-14 A4 인쇄본 테스트에서 20mm 판독 성공 확인. 상세는 디자이너 가이드 참조 (사내 문서).

---

## 호환성

| 환경 | 지원 |
|---|---|
| iOS Safari 15+ | ✓ |
| Android Chrome 90+ | ✓ |
| Desktop Chrome / Edge | ✓ (웹캠 필요) |
| Firefox | △ (일부 모바일에서 카메라 자동 시작 제한) |

HTTPS 환경에서만 동작. HTTP에서는 `getUserMedia` 차단.

---

## 라이선스

[LICENSE](./LICENSE) 참조 — 본 저장소의 모든 코드·디자인·이미지·바코드 데이터·브랜드 자산은 **주식회사 텐저블스토리**(TANGIBLESTORY)의 자산이며, 권한 없는 복제·재배포·상업적 사용을 금지합니다.

---

© 2026 acosmeticstory · 주식회사 텐저블스토리 (TANGIBLESTORY)
