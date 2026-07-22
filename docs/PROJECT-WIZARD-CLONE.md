# 프로젝트 마법사 clone — v2 정식 지원

프로젝트 생성 마법사의 Git clone 워크플로는 v2에서 재승격된 정식 지원 기능이다.

- 마법사는 `src/components/project-creation-wizard/`에 배치되며 `/api/projects/clone-progress`의 SSE 진행 상태를 사용한다.
- clone은 선택한 workspace 아래 새 대상 디렉터리에 수행되고, 성공하면 프로젝트로 등록된다.
- 대상 디렉터리가 이미 존재하면(같은 remote 또는 다른 remote 모두) 안전하게 거부한다. 다른 위치를 선택하거나 기존 디렉터리를 제거해야 한다.
- clone 스모크 e2e는 네트워크 없이 로컬 bare Git fixture로 clone·등록·기존 대상 거부를 검증한다.

이 선언은 새 clone 기능을 추가하지 않으며, 기존 clone 계약을 v2 지원 범위로 명시한다.
