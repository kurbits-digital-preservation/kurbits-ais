{{- define "kurbits.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "kurbits.fullname" -}}
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

{{- define "kurbits.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "kurbits.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Values.image.tag | default "latest" | toString | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: kurbits-ais
{{- end -}}

{{- define "kurbits.selectorLabels" -}}
app.kubernetes.io/name: {{ include "kurbits.name" .ctx }}
app.kubernetes.io/instance: {{ .ctx.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "kurbits.image" -}}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | default "latest" | toString) -}}
{{- end -}}

{{- define "kurbits.imagePullPolicy" -}}
{{- if .Values.image.pullPolicy -}}
{{- .Values.image.pullPolicy -}}
{{- else if eq (.Values.image.tag | default "latest" | toString) "latest" -}}
Always
{{- else -}}
IfNotPresent
{{- end -}}
{{- end -}}

{{- define "kurbits.appSecretName" -}}
{{- .Values.app.existingSecret | default (include "kurbits.fullname" .) -}}
{{- end -}}

{{- define "kurbits.uploadsClaimName" -}}
{{- .Values.persistence.uploads.existingClaim | default (printf "%s-uploads" (include "kurbits.fullname" .)) -}}
{{- end -}}

{{- define "kurbits.postgresql.fullname" -}}
{{- printf "%s-postgresql" (include "kurbits.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "kurbits.postgresql.image" -}}
{{- printf "%s:%s" .Values.postgresql.image.repository (.Values.postgresql.image.tag | toString) -}}
{{- end -}}

{{- define "kurbits.postgresql.secretName" -}}
{{- .Values.postgresql.auth.existingSecret | default (include "kurbits.postgresql.fullname" .) -}}
{{- end -}}

{{- define "kurbits.postgresql.claimName" -}}
{{- .Values.postgresql.persistence.existingClaim | default (printf "%s-data" (include "kurbits.postgresql.fullname" .)) -}}
{{- end -}}

{{- define "kurbits.secretData" -}}
{{- $existing := lookup "v1" "Secret" .ctx.Release.Namespace .secret -}}
{{- $current := dig "data" .key "" $existing -}}
{{- if .value -}}
{{- .value | b64enc -}}
{{- else if $current -}}
{{- $current -}}
{{- else -}}
{{- .generate | b64enc -}}
{{- end -}}
{{- end -}}

{{- define "kurbits.validate" -}}
{{- if and (not .Values.postgresql.enabled) (not .Values.externalDatabase.url) (not .Values.externalDatabase.existingSecret) (not .Values.app.existingSecret) -}}
{{- fail "postgresql.enabled=false kräver externalDatabase.url, externalDatabase.existingSecret eller app.existingSecret med DATABASE_URL" -}}
{{- end -}}
{{- end -}}