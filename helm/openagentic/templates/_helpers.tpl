{{/* Common labels applied to every object. */}}
{{- define "openagentic.labels" -}}
app.kubernetes.io/part-of: openagentic
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{/* Per-component selector labels. Pass a dict with .name */}}
{{- define "openagentic.selector" -}}
app: {{ .name }}
{{- end -}}

{{/* Fully-qualified image ref for an app service. Pass a dict: root .root, name .name */}}
{{- define "openagentic.image" -}}
{{ .root.Values.image.registry }}/openagentic-{{ .name }}:{{ .root.Values.image.tag }}
{{- end -}}

{{/* imagePullSecrets block (renders nothing when empty) */}}
{{- define "openagentic.pullSecrets" -}}
{{- with .Values.imagePullSecrets }}
imagePullSecrets:
{{ toYaml . | indent 8 }}
{{- end }}
{{- end -}}

{{/* POD-level securityContext for spec.template.spec. dict: root, name */}}
{{- define "openagentic.podSecurityContext" -}}
{{- $base := .root.Values.podSecurityContext | default dict -}}
{{- $ovr := dict -}}
{{- with .root.Values.podSecurityContext -}}
{{- with .overrides -}}
{{- $ovr = (index . $.name | default dict) -}}
{{- end -}}
{{- end -}}
{{- $defaults := omit $base "overrides" -}}
{{- $merged := mustMergeOverwrite (deepCopy $defaults) $ovr -}}
{{- if $merged -}}
securityContext:
{{- toYaml $merged | nindent 2 }}
{{- end -}}
{{- end -}}

{{/* CONTAINER-level securityContext for a container. dict: root, name */}}
{{- define "openagentic.securityContext" -}}
{{- $base := .root.Values.securityContext | default dict -}}
{{- $ovr := dict -}}
{{- with .root.Values.securityContext -}}
{{- with .overrides -}}
{{- $ovr = (index . $.name | default dict) -}}
{{- end -}}
{{- end -}}
{{- $defaults := omit $base "overrides" -}}
{{- $merged := mustMergeOverwrite (deepCopy $defaults) $ovr -}}
{{- if $merged -}}
securityContext:
{{- toYaml $merged | nindent 2 }}
{{- end -}}
{{- end -}}
