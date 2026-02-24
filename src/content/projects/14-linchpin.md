---
title: "Linchpin"
description: |
  1) 문제 정의
  단일 프롬프트만으로는 사내 규정/업무 맥락이 필요한 복합 질문을 안정적으로 해결하기 어려웠고, 문서/DB 기반 컨텍스트 확장이 필요했습니다.

  2) 설계 의사 결정
  - LangChain + LangGraph: 멀티 스텝 도구 호출, 분기, 재시도, 상태 전이를 명시적으로 다루기 위해 모델 오케스트레이션 구조를 채택했습니다.
  - Kubernetes: 팀별/워크로드별 격리와 트래픽 변동 대응을 위해 배포 단위를 표준화하고 수평 확장 기반 운영을 선택했습니다.
  - Redis: 문서 벡터 인덱싱과 저지연 조회 경로를 구성해 검색-응답 루프를 짧게 유지했습니다.

  3) 트레이드오프
  그래프 오케스트레이션과 K8s 도입으로 초기 설계/운영 복잡도는 증가했지만, 장애 대응과 기능 확장 시 변경 범위가 작아지는 구조적 이점을 확보했습니다.

  4) 결과
  사내 AI Agent Playground와 문서/데이터 파이프라인 기반 Agent 매니지먼트 시스템을 구축했고, 팀 Agent 개발/공유 이벤트 운영으로 조직의 AI 활용 이해도를 높였습니다.
thumbnail: "../../assets/portfolio/linchpin.svg
detailImage: "../../assets/portfolio/linchpin-2.png"
galleryImages:
  - "../../assets/portfolio/linchpin-1.png"
  - "../../assets/portfolio/linchpin-3.png"
  - "../../assets/portfolio/linchpin-architecture.png"
categories:
  - LangChain
  - LangGraph
  - Kotlin Spring
  - Redis
  - PostgreSQL
role: "사내 AI Agent 플레이그라운드 개발 리드"
links: []
year: 2026
order: 9999
---
