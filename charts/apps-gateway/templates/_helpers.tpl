{{/*
Expand the name of the chart.
*/}}
{{- define "claude-apps-gateway.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "claude-apps-gateway.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "claude-apps-gateway.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Common labels.
*/}}
{{- define "claude-apps-gateway.labels" -}}
helm.sh/chart: {{ include "claude-apps-gateway.chart" . }}
{{ include "claude-apps-gateway.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/*
Selector labels.
*/}}
{{- define "claude-apps-gateway.selectorLabels" -}}
app.kubernetes.io/name: {{ include "claude-apps-gateway.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
Resolve namespace.
*/}}
{{- define "claude-apps-gateway.namespace" -}}
{{- default .Release.Namespace .Values.namespace.name -}}
{{- end -}}

{{/*
Create the name of the service account to use.
*/}}
{{- define "claude-apps-gateway.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "claude-apps-gateway.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/*
Create the name of the Secret to use.
*/}}
{{- define "claude-apps-gateway.secretName" -}}
{{- default (printf "%s-secrets" (include "claude-apps-gateway.fullname" .)) .Values.secrets.name -}}
{{- end -}}
