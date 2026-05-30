{{/*
Expand the name of the chart.
*/}}
{{- define "openagentic.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "openagentic.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "openagentic.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "openagentic.labels" -}}
helm.sh/chart: {{ include "openagentic.chart" . }}
{{ include "openagentic.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "openagentic.selectorLabels" -}}
app.kubernetes.io/name: {{ include "openagentic.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "openagentic.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "openagentic.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Redis service name for Bitnami Redis subchart
When sentinel is enabled, service name is {{ .Release.Name }}-redis (routes to current master)
When sentinel is disabled, service name is {{ .Release.Name }}-redis-master
Supports external Redis via externalRedis.host
*/}}
{{- define "openagentic.redis.serviceName" -}}
{{- if and .Values.externalRedis .Values.externalRedis.host -}}
{{- .Values.externalRedis.host }}
{{- else if and .Values.redis .Values.redis.sentinel .Values.redis.sentinel.enabled -}}
{{- printf "%s-redis" .Release.Name }}
{{- else -}}
{{- printf "%s-redis-master" .Release.Name }}
{{- end -}}
{{- end }}

{{/*
Redis port - supports external Redis via externalRedis.port
*/}}
{{- define "openagentic.redis.port" -}}
{{- if and .Values.externalRedis .Values.externalRedis.port -}}
{{- .Values.externalRedis.port }}
{{- else if and .Values.redis .Values.redis.master .Values.redis.master.service -}}
{{- .Values.redis.master.service.ports.redis | default 6379 }}
{{- else if and .Values.redis .Values.redis.service -}}
{{- .Values.redis.service.ports.redis | default 6379 }}
{{- else }}
{{- 6379 }}
{{- end }}
{{- end }}

{{/*
Redis service URL for Bitnami Redis subchart (with password if auth enabled)
Supports external Redis via externalRedis
*/}}
{{- define "openagentic.redis.url" -}}
{{- if and .Values.externalRedis .Values.externalRedis.password -}}
{{- printf "redis://:%s@%s:%s" .Values.externalRedis.password (include "openagentic.redis.serviceName" .) (include "openagentic.redis.port" .) }}
{{- else if and .Values.redis .Values.redis.auth .Values.redis.auth.enabled .Values.redis.auth.password -}}
{{- printf "redis://:%s@%s:%s" .Values.redis.auth.password (include "openagentic.redis.serviceName" .) (include "openagentic.redis.port" .) }}
{{- else -}}
{{- printf "redis://%s:%s" (include "openagentic.redis.serviceName" .) (include "openagentic.redis.port" .) }}
{{- end -}}
{{- end }}

{{/*
Redis password - supports external Redis via externalRedis.password
*/}}
{{- define "openagentic.redis.password" -}}
{{- if and .Values.externalRedis .Values.externalRedis.password -}}
{{- .Values.externalRedis.password }}
{{- else if and .Values.redis .Values.redis.auth .Values.redis.auth.password -}}
{{- .Values.redis.auth.password }}
{{- else -}}
{{- "" }}
{{- end -}}
{{- end }}

{{/*
PostgreSQL service name for Bitnami PostgreSQL subchart
When architecture is replication, service name is {{ .Release.Name }}-postgresql-primary
When architecture is standalone, service name is {{ .Release.Name }}-postgresql
Supports external PostgreSQL via externalPostgresql.host
*/}}
{{- define "openagentic.postgresql.serviceName" -}}
{{- if and .Values.externalPostgresql .Values.externalPostgresql.host -}}
{{- .Values.externalPostgresql.host }}
{{- else if and .Values.postgres .Values.postgres.enabled -}}
{{- printf "%s-postgres" .Release.Name }}
{{- else if and .Values.postgresql .Values.postgresql.architecture (eq .Values.postgresql.architecture "replication") -}}
{{- printf "%s-postgresql-primary" .Release.Name }}
{{- else -}}
{{- printf "%s-postgresql" .Release.Name }}
{{- end -}}
{{- end }}

{{/*
PostgreSQL port - supports external PostgreSQL via externalPostgresql.port
*/}}
{{- define "openagentic.postgresql.port" -}}
{{- if and .Values.externalPostgresql .Values.externalPostgresql.port -}}
{{- .Values.externalPostgresql.port }}
{{- else -}}
{{- 5432 }}
{{- end -}}
{{- end }}

{{/*
PostgreSQL username - supports external PostgreSQL via externalPostgresql.username
*/}}
{{- define "openagentic.postgresql.username" -}}
{{- if and .Values.externalPostgresql .Values.externalPostgresql.username -}}
{{- .Values.externalPostgresql.username }}
{{- else if and .Values.postgres .Values.postgres.enabled -}}
{{- .Values.postgres.username | default "openagentic" }}
{{- else if and .Values.postgresql .Values.postgresql.auth -}}
{{- .Values.postgresql.auth.username }}
{{- else -}}
{{- "openagentic" }}
{{- end -}}
{{- end }}

{{/*
PostgreSQL password - supports external PostgreSQL via externalPostgresql.password
*/}}
{{- define "openagentic.postgresql.password" -}}
{{- if and .Values.externalPostgresql .Values.externalPostgresql.password -}}
{{- .Values.externalPostgresql.password }}
{{- else if and .Values.postgres .Values.postgres.enabled -}}
{{- required "postgres.password is required - do not use defaults (FedRAMP Bolt 01)" .Values.postgres.password }}
{{- else if and .Values.postgresql .Values.postgresql.auth -}}
{{- required "postgresql.auth.password is required - do not use defaults (FedRAMP Bolt 01)" .Values.postgresql.auth.password }}
{{- else -}}
{{- fail "PostgreSQL password must be explicitly set - no default fallback allowed (FedRAMP Bolt 01)" }}
{{- end -}}
{{- end }}

{{/*
PostgreSQL database - supports external PostgreSQL via externalPostgresql.database
*/}}
{{- define "openagentic.postgresql.database" -}}
{{- if and .Values.externalPostgresql .Values.externalPostgresql.database -}}
{{- .Values.externalPostgresql.database }}
{{- else if and .Values.postgres .Values.postgres.enabled -}}
{{- .Values.postgres.database | default "openagentic" }}
{{- else if and .Values.postgresql .Values.postgresql.auth -}}
{{- .Values.postgresql.auth.database }}
{{- else -}}
{{- "openagentic" }}
{{- end -}}
{{- end }}

{{/*
Milvus service name for Milvus subchart
IMPORTANT: Milvus subchart creates services with pattern {{ .Release.Name }}-milvus
NOT {{ include "openagentic.fullname" . }}-milvus
Supports external Milvus via externalMilvus.host
*/}}
{{- define "openagentic.milvus.serviceName" -}}
{{- if and .Values.externalMilvus .Values.externalMilvus.host -}}
{{- .Values.externalMilvus.host }}
{{- else -}}
{{- printf "%s-milvus" .Release.Name }}
{{- end -}}
{{- end }}

{{/*
Milvus port - supports external Milvus via externalMilvus.port
*/}}
{{- define "openagentic.milvus.port" -}}
{{- if and .Values.externalMilvus .Values.externalMilvus.port -}}
{{- .Values.externalMilvus.port }}
{{- else if and .Values.milvus .Values.milvus.service -}}
{{- .Values.milvus.service.port | default 19530 }}
{{- else }}
{{- 19530 }}
{{- end }}
{{- end }}


{{/*
Etcd service name (dependency of Milvus)
IMPORTANT: Etcd subchart creates services with pattern {{ .Release.Name }}-etcd
*/}}
{{- define "openagentic.etcd.serviceName" -}}
{{- printf "%s-etcd" .Release.Name }}
{{- end }}

{{/*
Etcd port
*/}}
{{- define "openagentic.etcd.port" -}}
{{- 2379 }}
{{- end }}

{{/*
MinIO service name (dependency of Milvus)
IMPORTANT: MinIO subchart creates services with pattern {{ .Release.Name }}-minio
*/}}
{{- define "openagentic.minio.serviceName" -}}
{{- printf "%s-minio" .Release.Name }}
{{- end }}

{{/*
MinIO port
*/}}
{{- define "openagentic.minio.port" -}}
{{- 9000 }}
{{- end }}

{{/*
API service name
NOTE: API is a primary service, not a subchart
*/}}
{{- define "openagentic.api.serviceName" -}}
{{- printf "%s-api" (include "openagentic.fullname" .) }}
{{- end }}

{{/*
API port
*/}}
{{- define "openagentic.api.port" -}}
{{- .Values.api.service.port | default 8000 }}
{{- end }}

{{/*
UI service name
NOTE: UI is a primary service, not a subchart
*/}}
{{- define "openagentic.ui.serviceName" -}}
{{- printf "%s-ui" (include "openagentic.fullname" .) }}
{{- end }}

{{/*
UI port
*/}}
{{- define "openagentic.ui.port" -}}
{{- .Values.ui.service.port | default 80 }}
{{- end }}

{{/*
Ollama service name
NOTE: Ollama is a primary service, not a subchart
*/}}
{{- define "openagentic.ollama.serviceName" -}}
{{- printf "%s-ollama" (include "openagentic.fullname" .) }}
{{- end }}

{{/*
Ollama port
*/}}
{{- define "openagentic.ollama.port" -}}
{{- .Values.ollama.service.port | default 11434 }}
{{- end }}

{{/*
Ollama base URL
*/}}
{{- define "openagentic.ollama.url" -}}
{{- printf "http://%s:%s" (include "openagentic.ollama.serviceName" .) (include "openagentic.ollama.port" .) }}
{{- end }}

{{/*
Secret name helper
*/}}
{{- define "openagentic.secretName" -}}
{{- printf "%s-secret" (include "openagentic.fullname" .) }}
{{- end }}

{{/*
AWS Secret name helper
*/}}
{{- define "openagentic.awsSecretName" -}}
{{- printf "%s-aws-secrets" (include "openagentic.fullname" .) }}
{{- end }}

{{/*
MCP Proxy service name
*/}}
{{- define "openagentic.mcpProxy.serviceName" -}}
{{- printf "%s-mcp-proxy" (include "openagentic.fullname" .) }}
{{- end }}

{{/*
MCP Proxy port
*/}}
{{- define "openagentic.mcpProxy.port" -}}
{{- .Values.mcpProxy.service.port | default 8080 }}
{{- end }}

{{/*
MCP Proxy internal URL
*/}}
{{- define "openagentic.mcpProxy.internalUrl" -}}
{{- printf "http://%s:%s" (include "openagentic.mcpProxy.serviceName" .) (include "openagentic.mcpProxy.port" . | toString) }}
{{- end }}


{{/*
Safely retrieve a secret value with fallback chain:
1. Use explicit override value if set
2. Use existing secret value from cluster (preserves across upgrades)
3. Generate random value as last resort
Args: dict with keys: override, data (existing secret .data map), key, length (default 32)
*/}}
{{- define "openagentic.secretOrGenerate" -}}
{{- $override := .override | default "" -}}
{{- $data := .data | default dict -}}
{{- $key := .key -}}
{{- $length := .length | default 32 | int -}}
{{- if $override -}}
{{- $override -}}
{{- else if hasKey $data $key -}}
{{- index $data $key | b64dec -}}
{{- else -}}
{{- randAlphaNum $length -}}
{{- end -}}
{{- end -}}

