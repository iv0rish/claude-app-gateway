# Prompt Logging

`llm-gateway`는 인증과 request validation을 통과한 모든 prompt를 structured audit log로 남긴다.

## 설정

| 환경 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PROMPT_LOGGING_ENABLED` | `true` | raw prompt logging 활성화 |

## 로깅 시점

Prompt log는 다음 순서에서 기록된다.

```text
authentication
  -> request validation
  -> prompt.logged audit event
  -> rate limit
  -> guardrail
  -> upstream
```

따라서 rate limit이나 guardrail로 차단되는 요청도 prompt가 기록된다.

## 추출 대상

다음 text를 하나의 prompt text로 합쳐 기록한다.

- `system` string.
- `system[]` 중 text block.
- `messages[].content` string.
- `messages[].content[]` 중 `type:"text"`.
- `messages[].content[]` 중 `type:"tool_result"`의 text content.

이미지, 파일, tool schema 전체, tool use metadata는 기록하지 않는다.

## Audit Event

Event:

```text
prompt.logged
```

필드:

| 필드 | 설명 |
| --- | --- |
| `tier` | Apps Gateway shared secret tier |
| `model` | request model |
| `promptText` | raw prompt text |
| `promptLength` | prompt text length |

## 보안 기준

Prompt log는 원문 prompt를 포함한다. 운영에서는 다음을 별도로 강제한다.

- log sink 접근 제어.
- 보존 기간.
- 검색 권한.
- 외부 전송 제한.
- incident 대응 절차.

