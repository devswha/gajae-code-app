# 재라이선싱(AGPL → MIT) 작업 핸드오프

작성일: 2026-09-01. 이 문서는 AGPL 위험 코드 제거 작업을 중단하는 시점의 상태를 인수인계하기 위한 것입니다. 아래 내용은 전부 이 세션에서 실제 명령 출력으로 확인한 사실입니다.

## 현재 상태 요약

- 브랜치 `main`은 원격과 동기화되어 있고 워킹 트리는 깨끗합니다. 최신 커밋은 `faf2b46`.
- `package.json`: 버전 `2.0.0-beta.7`, 라이선스 `MIT`. (beta.6까지는 AGPL로 배포되었으므로 버전을 분리했습니다.)
- upstream 유사도 실측치: **99,070줄 중 88줄 (0.1%)**, 전부 `package.json` 한 파일.
- 전체 게이트 `npm run verify`(audit·license·notices·typecheck·Rust·tests·lint·identity·build)는 `faf2b46` 트리에서 통과 확인됨.

## 이번 작업에서 수행한 커밋 (오래된 것부터)

| 커밋 | 내용 |
| --- | --- |
| `ad1c720` | MIT로 재라이선스 선언 (`feat!`) |
| `22cc752` | 프로젝트가 AGPL이라는 마지막 문구들 제거 |
| `eaa2cd1` | upstream 유래 코드를 독자적 표현으로 재작성 (CSS, server utils, DB schema DDL, issue template 등) |
| `2e887f0` | 잔존 유사도를 의존성 manifest(`package.json`) 수준까지 축소, 버전 beta.7로 분리 |
| `faf2b46` | nginx subpath 템플릿의 per-route proxy 스코핑 원복 (라이선스와 무관한 기능 변경 되돌림) |

## 핵심 결정과 근거

1. **의존성**: npm 트리는 `scripts/check-dependency-licenses.mjs` 게이트를 통과. AGPL인 `mupdf`와 EPL-2.0인 `elkjs`는 `scripts/release/distribution-exclusions.mjs`로 배포 산출물에서 제외됩니다. Rust crates는 전부 MIT/Apache-2.0 계열로 확인.
2. **파생 코드**: `scripts/measure-upstream-derivation.mjs`로 정량 추적하며 6,554줄 → 206줄 → 88줄로 축소했습니다. 남은 88줄은 `package.json`의 의존성 선언·스크립트 호출로, "표현"이 아닌 "사실/인터페이스"라는 엔지니어링 판단으로 수용했습니다. 상세 논거는 `docs/RELICENSING.md` 참조.
3. **nginx 템플릿**: 재작성 과정에서 발생한 기능 변경(`Accept-Encoding` 제거·`Upgrade` 헤더·타임아웃의 server 레벨 승격)을 전부 원래의 location별 스코핑으로 되돌렸고, stub upstream 대상 A/B 테스트 12종에서 바이트 단위 동일 응답(zero diff)을 확인했습니다.

## 잔여 리스크 (미해결)

- **88줄이 0이 아닙니다.** "AGPL 위험 전부 제거"라는 목표 기준으로는 미완입니다. `package.json`의 의존성 목록은 기능 유지를 위해 필연적으로 upstream과 겹치며, 이를 더 줄이려면 의존성 자체를 교체해야 합니다.
- **법률 검토 없음.** `docs/RELICENSING.md`의 판단은 엔지니어링 평가이며 법률 자문이 아닙니다. MIT 재라이선스의 저작권 유효성은 별도 법률 검토가 필요합니다.
- ~~`docs/LICENSING.md`의 패키지 수(582)가 현재 실측치와 불일치합니다.~~ → 2026-09-02 해결: 배포물 기준 실측치(550, `THIRD-PARTY-NOTICES.md` 기준)로 갱신 완료.

## 재개 시 검증 방법

```bash
node scripts/measure-upstream-derivation.mjs   # 잔존 유사도 측정 (현재 88줄)
node scripts/classify-residual-overlap.mjs     # 잔존 유사도 분류
npm run verify                                  # 전체 게이트
```

nginx 템플릿을 다시 손댈 경우, 이번 세션에서 사용한 방식대로 stub upstream을 띄워 구/신 설정에 동일 요청을 보내고 응답을 diff로 비교한 뒤에만 반영하십시오.
