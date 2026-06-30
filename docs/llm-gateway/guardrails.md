# Bedrock Guardrails

`llm-gateway`는 Bedrock Runtime `ApplyGuardrail` API로 input과 output을 검사한다.

## 설정

필수 환경 변수:

| 환경 변수 | 설명 |
| --- | --- |
| `BEDROCK_REGION` | Bedrock Runtime region |
| `BEDROCK_GUARDRAIL_ID` | guardrail identifier |
| `BEDROCK_GUARDRAIL_VERSION` | guardrail version |

활성화:

| 환경 변수 | 설명 |
| --- | --- |
| `GUARDRAIL_INPUT_ENABLED` | input 검사 |
| `GUARDRAIL_OUTPUT_ENABLED` | output 검사 |
| `GUARDRAIL_FAIL_POLICY` | `closed` 또는 `open` |

## Input Guardrail

검사 대상:

- `system` string.
- `system[]` 중 text block.
- `messages[].content` string.
- `messages[].content[]` 중 `type:"text"`.
- `messages[].content[]` 중 `type:"tool_result"`의 text content.

검사하지 않는 대상:

- image content.
- file content.
- tool schema JSON 전체.
- tool use metadata.

`GUARDRAIL_INTERVENED`이면 upstream을 호출하지 않고 `400 invalid_request_error`를 반환한다.

## Output Guardrail

검사 대상:

- upstream response `content[]` 중 `type:"text"`.

`GUARDRAIL_INTERVENED`이면 원문 output을 반환하지 않고 refusal response로 대체한다.

```json
{
  "id": "msg_guardrail",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "This response was blocked by the organization's safety policy."
    }
  ],
  "stop_reason": "end_turn"
}
```

Bedrock 응답 `outputs[].text`가 있으면 해당 text를 우선 사용하고, 없으면 `REFUSAL_TEXT`를 사용한다.

## Fail Policy

`GUARDRAIL_FAIL_POLICY=closed`:

- Bedrock 호출 실패 시 `503 api_error`.
- upstream 또는 client로 unsafe path를 열지 않는다.

`GUARDRAIL_FAIL_POLICY=open`:

- Bedrock 호출 실패 시 guardrail을 통과한 것으로 취급한다.
- 개발/임시 장애 대응 외에는 권장하지 않는다.

## IAM

ServiceAccount에 Bedrock Runtime 권한을 부여한다.

```json
{
  "Effect": "Allow",
  "Action": "bedrock:ApplyGuardrail",
  "Resource": "*"
}
```

운영에서는 guardrail ARN 또는 account/region 조건으로 좁힌다.

