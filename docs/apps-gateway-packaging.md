# Claude Apps Gateway 패키징 및 EKS 배포 가이드

이 문서는 Claude Apps Gateway와 inference policy proxy를 EKS에 배포하기 위한 패키징, Kubernetes 리소스, 네트워크 정책, 운영 확인 절차를 정의한다. Gateway 설정 자체는 [apps-gateway-config.md](./apps-gateway-config.md), proxy 구현 기준은 [apps-gateway-upstream-proxy.md](./apps-gateway-upstream-proxy.md)를 따른다.

참고 문서:

- Claude Apps Gateway deployment: https://code.claude.com/docs/en/claude-apps-gateway-deploy
- Claude Apps Gateway configuration: https://code.claude.com/docs/en/claude-apps-gateway-config

## Container Image

Gateway는 `claude gateway --config /etc/claude/gateway.yaml`로 실행한다. config는 image에 bake하지 않고 ConfigMap으로 주입하며, secret은 Kubernetes Secret/env로 전달한다.

예시 Dockerfile:

```dockerfile
FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Download a pinned Linux claude binary outside the image build,
# verify it against the signed release manifest, then copy it here.
COPY claude /usr/local/bin/claude
RUN chmod +x /usr/local/bin/claude

ENV CLAUDE_CONFIG_DIR=/tmp/.claude
EXPOSE 8080

ENTRYPOINT ["claude", "gateway", "--config", "/etc/claude/gateway.yaml"]
```

운영 빌드 기준:

- `claude` binary는 검증한 버전으로 pinning하고, 공식 release manifest로 무결성을 확인한 뒤 build context에 둔다.
- image tag에는 Gateway 버전과 git SHA를 포함한다.
- rootless 실행을 원하면 `/tmp/.claude`를 쓸 수 있는 non-root user를 만들고 `securityContext.runAsNonRoot: true`를 설정한다.
- image 안에는 OIDC secret, JWT secret, Postgres URL, proxy/vLLM key를 포함하지 않는다.

## Kubernetes 리소스

필수 리소스:

- `Namespace`: `llm-gateway`
- `ServiceAccount`: Gateway Pod 전용
- `ConfigMap`: `gateway.yaml`
- `Secret`: `OIDC_CLIENT_SECRET`, `GATEWAY_JWT_SECRET`, `GATEWAY_POSTGRES_URL`, `VLLM_STANDARD_KEY`
- Tier별 upstream을 쓰는 경우 `VLLM_PREMIUM_KEY` 같은 추가 shared secret
- `Deployment`: `claude-apps-gateway`
- `Service`: Gateway ClusterIP, port 8080
- `Deployment`: `llm-policy-proxy`
- `Service`: policy proxy ClusterIP, port 8080
- `Redis`: rate-limit counter store
- `Ingress`: internal ALB 또는 사내 ingress controller
- `NetworkPolicy`: ingress/egress 제한

## Gateway Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: claude-apps-gateway
  namespace: llm-gateway
spec:
  replicas: 2
  selector:
    matchLabels:
      app: claude-apps-gateway
  template:
    metadata:
      labels:
        app: claude-apps-gateway
    spec:
      serviceAccountName: claude-apps-gateway
      containers:
        - name: gateway
          image: <account>.dkr.ecr.<region>.amazonaws.com/claude-apps-gateway:<version>
          ports:
            - containerPort: 8080
          envFrom:
            - secretRef:
                name: claude-apps-gateway-secrets
          volumeMounts:
            - name: config
              mountPath: /etc/claude
              readOnly: true
          readinessProbe:
            httpGet:
              path: /readyz
              port: 8080
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8080
          resources:
            requests:
              cpu: 250m
              memory: 512Mi
            limits:
              cpu: "1"
              memory: 1Gi
      volumes:
        - name: config
          configMap:
            name: claude-apps-gateway-config
```

## Ingress

- ALB는 internal scheme으로 생성한다.
- TLS는 ALB/Ingress에서 종료한다.
- `listen.public_url`과 인증서 SAN의 hostname이 일치해야 한다.
- IdP redirect URI는 `https://claude-gateway.internal.example.com/oauth/callback`으로 등록한다.
- 사내 DNS에서 Gateway hostname은 private address로만 resolve되어야 한다.

## NetworkPolicy

Gateway ingress:

- internal ALB/Ingress controller namespace에서 오는 8080만 허용한다.

Gateway egress:

- policy proxy Service `llm-policy-proxy.llm-gateway.svc.cluster.local:8080`
- RDS PostgreSQL endpoint
- OIDC issuer/token/userinfo endpoints
- 필요 시 OTLP collector
- Kubernetes DNS

policy proxy egress:

- vLLM Service `vllm.vllm.svc.cluster.local:8000`
- Bedrock Runtime `ApplyGuardrail` endpoint
- Redis
- Kubernetes DNS

차단 기준:

- Gateway Pod에서 `api.anthropic.com:443`으로 직접 egress할 수 없어야 한다.
- vLLM 장애 시 외부 Anthropic API로 failover하지 않아야 한다.

## 운영 확인 절차

1. Gateway container가 시작되는지 확인한다.

   ```sh
   kubectl -n llm-gateway logs deploy/claude-apps-gateway
   ```

2. health endpoint를 확인한다.

   ```sh
   kubectl -n llm-gateway port-forward svc/claude-apps-gateway 8080:8080
   curl -fsS http://127.0.0.1:8080/healthz
   curl -fsS http://127.0.0.1:8080/readyz
   ```

3. OAuth discovery/device flow endpoint가 응답하는지 확인한다.

   ```sh
   curl -fsS https://claude-gateway.internal.example.com/.well-known/oauth-authorization-server
   ```

4. 개발자 머신에서 managed settings 배포 후 `claude`를 실행하고 gateway login이 강제되는지 확인한다.

5. 모델 요청 시 policy proxy와 vLLM Pod log에 `/v1/messages` 요청이 찍히는지 확인한다.

   ```sh
   kubectl -n llm-gateway logs deploy/llm-policy-proxy
   kubectl -n vllm logs deploy/vllm
   ```

6. rate limit을 초과하는 burst 요청이 `429`로 차단되고 vLLM까지 전달되지 않는지 확인한다.

7. guardrail 차단 샘플 요청이 vLLM까지 전달되지 않고 policy proxy에서 차단되는지 확인한다.

8. Gateway Pod에서 외부 Anthropic API로 직접 나갈 수 없는지 확인한다.

   ```sh
   kubectl -n llm-gateway exec deploy/claude-apps-gateway -- \
     sh -lc 'curl -I --connect-timeout 3 https://api.anthropic.com || true'
   ```

9. vLLM Service를 일시적으로 중단했을 때 Gateway가 외부 Anthropic API로 failover하지 않고 upstream 오류를 반환하는지 확인한다.

## 장애 대응 기준

| 증상 | 우선 확인 |
| --- | --- |
| Gateway boot 실패 | `gateway.yaml` schema error, secret env 누락, Postgres URL 형식 |
| Login redirect 실패 | `listen.public_url`, IdP redirect URI, ALB hostname/TLS |
| User rejected | `allowed_email_domains`, `allowed_groups`, IdP claim mapping |
| `/readyz` 실패 | Postgres 연결, OIDC discovery 접근, config validation |
| 모델 요청 4xx | `models[].id`, `upstream_model.<upstream-name>`, vLLM served model name |
| 모델 요청 5xx/timeout | vLLM Pod 상태, GPU capacity, Gateway `timeouts.upstream_ttfb_ms` |
| rate limit이 동작하지 않음 | Gateway upstream `base_url`, proxy `x-api-key` 검증, Redis 연결, bucket 설정 |
| guardrail이 동작하지 않음 | Bedrock Guardrail ID/version, IAM `bedrock:ApplyGuardrail`, proxy fail policy, source 설정 |
| vLLM log에 요청 없음 | `base_url`, policy proxy log, NetworkPolicy egress, Service DNS, Service selector |
| 외부 Anthropic 호출 발생 | Gateway upstream에 외부 Anthropic upstream이 남아 있는지, egress policy가 열려 있는지 |

## 수용 기준

- Claude Code managed settings가 Gateway login을 강제한다.
- Gateway OIDC login이 사내 계정으로만 성공한다.
- Gateway `/healthz`, `/readyz`가 정상이다.
- Claude Code에서 허용된 모델만 선택 가능하다.
- 모델 요청은 policy proxy를 거쳐 vLLM `/v1/messages`로 전달된다.
- rate limit 초과 요청은 `429`로 실패하고 vLLM에 전달되지 않는다.
- guardrail 차단 요청은 vLLM에 전달되지 않거나 출력 반환 전에 대체된다.
- Gateway Pod에서 `api.anthropic.com:443`으로 직접 egress할 수 없다.
- vLLM 장애 시 요청은 실패해야 하며 외부 Anthropic API로 우회되지 않는다.
- Gateway image에는 secret이 포함되어 있지 않다.
- `gateway.yaml`과 Kubernetes Secret 교체만으로 OIDC, Postgres, vLLM endpoint/key를 변경할 수 있다.
